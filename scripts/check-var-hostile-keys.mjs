#!/usr/bin/env node
// Derive the var-hostile key list from Tailwind, and fail when it drifts.
//
// `packages/compiler/src/var-hostile-keys.ts` names the sz keys whose runtime
// value cannot be lowered to `<prefix>-(--var)`, because Tailwind either emits
// no rule for that class or emits one for a DIFFERENT CSS property. Membership
// is not a judgement call, so it should not be maintained as one: this script
// asks the pinned Tailwind directly and compares.
//
// The comparison, per documented key:
//
//   intended  = the CSS properties a documented STATIC class for the key sets
//   from-var  = the CSS properties the `-(--var)` class sets, if any
//   hostile   = from-var is empty, or shares no property with intended
//
// A Tailwind upgrade that adds an arbitrary-value form for one of these keys
// should take it OFF the list, not leave csszyx warning about a shape that now
// works — which is the drift this gate exists to catch.
//
// The docs list the same keys per reference page, from one map in
// `apps/docs/src/components/RuntimeValueNote.tsx`. That map is checked against
// the engine here too: a key the build drops but no page mentions is the shape
// that costs trust — a developer hits a report the documentation never
// anticipated.
//
// Every list this script reads is a named declaration in a TypeScript file, so
// it reads them through the shared TypeScript-parser extractor rather than by
// regex — see `scripts/extract-ts-tables.mjs` for why that distinction is not
// cosmetic here.
//
// Usage: node scripts/check-var-hostile-keys.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { readTableSource } from './extract-ts-tables.mjs';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** camelCase to kebab-case, matching the engine's `kebab_case`. */
function kebab(key) {
    return key.replaceAll(/[A-Z]/g, character => `-${character.toLowerCase()}`);
}

/**
 * The class the engine would emit for a runtime value on this key.
 *
 * Mirrors `dynamic_css_var_from_property`, including its fallback of using the
 * raw key when no prefix is mapped — a shape that is itself part of what makes
 * some of these keys hostile.
 *
 * @param key - The sz key.
 * @param prefixes - Key to Tailwind prefix map.
 * @returns The `<prefix>-(--_sz-<kebab>)` class.
 */
export function varClassFor(key, prefixes) {
    return `${prefixes[key] ?? key}-(--_sz-${kebab(key)})`;
}

/**
 * Compile candidates through the pinned Tailwind and index their declarations.
 *
 * @param candidates - Class names to build.
 * @returns Class name mapped to the real CSS properties its rule sets.
 */
async function propertiesByClass(candidates) {
    const tailwind = require('tailwindcss');
    const compiler = await tailwind.compile('@import "tailwindcss";', {
        base: ROOT,
        loadStylesheet: async (id, base) => {
            const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id, {
                paths: [ROOT],
            });
            return { base, path, content: readFileSync(path, 'utf8') };
        },
    });
    const css = compiler.build([...new Set(candidates)]);
    const found = new Map();
    for (const rule of css.matchAll(/^ *\.((?:[^{\n\\]|\\.)+?) \{\n([\s\S]*?)^ *\}/gm)) {
        const properties = [...rule[2].matchAll(/^\s*([a-z-]+)\s*:/gm)]
            .map(declaration => declaration[1])
            // `--tw-*` plumbing says nothing about which property the rule sets.
            .filter(property => !property.startsWith('--'));
        found.set(rule[1].replaceAll('\\', ''), new Set(properties));
    }
    return found;
}

/**
 * Report the keys Tailwind says are hostile, and the ones it says are not.
 *
 * @returns Process exit code.
 */
async function main() {
    const hostile = readTableSource(`${ROOT}packages/compiler/src/var-hostile-keys.ts`);
    const declared = new Set([
        ...hostile.stringSet('VAR_HOSTILE_WRONG_PROPERTY'),
        ...hostile.stringSet('VAR_HOSTILE_NO_VAR_FORM'),
    ]);
    // The same declarations the Rust engine reads: `pnpm gen:rust-tables` renders
    // them into its generated tables, and `gen:rust-tables:check` fails when that
    // copy is stale, so comparing against the TypeScript source compares against
    // what the engine runs.
    const core = readTableSource(`${ROOT}packages/compiler/src/transform-core.ts`);
    const prefixes = Object.fromEntries(core.stringObject('PROPERTY_MAP'));
    // A boolean-only key never reaches the css-var lane — its runtime value
    // goes through `__szBoolClass` — so it is hostile in the same sense and
    // already handled. Listing it again would drop a class that works.
    const alreadyRouted = new Set(core.objectKeys('BOOLEAN_ONLY_DYNAMIC_VOCABULARY'));
    const cases = JSON.parse(
        readFileSync(`${ROOT}packages/cli/tests/generated/sz-key-cases.json`, 'utf8'),
    );

    // A variant-prefixed documented class describes the variant, not the key.
    const staticClasses = Object.fromEntries(
        Object.entries(cases.keys).map(([key, entry]) => [
            key,
            (entry.forward ?? []).map(one => one.class).filter(one => one && !one.includes(':')),
        ]),
    );
    const keys = Object.keys(staticClasses).filter(
        key => staticClasses[key].length > 0 && !alreadyRouted.has(key),
    );
    const properties = await propertiesByClass([
        ...keys.map(key => varClassFor(key, prefixes)),
        ...keys.flatMap(key => staticClasses[key]),
    ]);

    const derived = new Set();
    for (const key of keys) {
        const intended = new Set(
            staticClasses[key].flatMap(one => [...(properties.get(one) ?? [])]),
        );
        // A key whose own documented class Tailwind does not know is out of
        // scope: this gate compares two forms, and cannot with only one.
        if (intended.size === 0) continue;
        const fromVar = properties.get(varClassFor(key, prefixes));
        if (fromVar === undefined || ![...fromVar].some(property => intended.has(property))) {
            derived.add(key);
        }
    }

    const documented = new Set(
        Object.values(
            readTableSource(
                `${ROOT}apps/docs/src/components/RuntimeValueNote.tsx`,
            ).stringArrayRecord('KEYS_WITHOUT_A_RUNTIME_FORM'),
        ).flat(),
    );
    const missing = [...derived].filter(key => !declared.has(key)).sort();
    const stale = [...declared].filter(key => !derived.has(key)).sort();
    const undocumented = [...declared].filter(key => !documented.has(key)).sort();
    const overdocumented = [...documented].filter(key => !declared.has(key)).sort();
    if (
        missing.length === 0 &&
        stale.length === 0 &&
        undocumented.length === 0 &&
        overdocumented.length === 0
    ) {
        console.log(
            `[var-hostile] ${declared.size} keys, all confirmed against Tailwind and documented.`,
        );
        return 0;
    }
    if (undocumented.length > 0) {
        console.error(
            '\n[var-hostile] the build drops these, but no reference page lists them — add ' +
                'them to KEYS_WITHOUT_A_RUNTIME_FORM in ' +
                'apps/docs/src/components/RuntimeValueNote.tsx:\n  ' +
                undocumented.join('\n  '),
        );
    }
    if (overdocumented.length > 0) {
        console.error(
            '\n[var-hostile] the docs claim these need a build-time value, but the build ' +
                'accepts a runtime one — remove them from RuntimeValueNote.tsx:\n  ' +
                overdocumented.join('\n  '),
        );
    }

    if (missing.length > 0) {
        console.error(
            '\n[var-hostile] Tailwind cannot lower a runtime value for these keys, and ' +
                'var-hostile-keys.ts does not list them:\n  ' +
                missing.join('\n  '),
        );
    }
    if (stale.length > 0) {
        console.error(
            '\n[var-hostile] var-hostile-keys.ts lists these, but Tailwind now lowers them ' +
                'correctly — take them off the list rather than keep warning:\n  ' +
                stale.join('\n  '),
        );
    }
    return 1;
}

process.exit(await main());
