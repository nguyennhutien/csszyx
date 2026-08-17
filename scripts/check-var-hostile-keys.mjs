#!/usr/bin/env node
// Derive the var-hostile key list from Tailwind, and fail when it drifts.
//
// `packages/core/src/transform/var_hostile.rs` names the sz keys whose runtime
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
// Usage: node scripts/check-var-hostile-keys.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Read a Rust `matches!(key, "a" | "b" | …)` arm list out of a source file.
 *
 * @param source - The Rust source text.
 * @param functionName - Name of the function whose arms to read.
 * @returns The string literals that function matches.
 */
export function rustMatchArms(source, functionName) {
    const start = source.indexOf(`fn ${functionName}(`);
    if (start === -1) throw new Error(`${functionName} not found`);
    const body = source.slice(start, source.indexOf('\n}', start));
    return [...body.matchAll(/"([A-Za-z0-9]+)"/g)].map(match => match[1]);
}

/**
 * Read the csszyx key to Tailwind prefix map out of the generated table.
 *
 * @param source - `generated/tables.rs` text.
 * @returns Key mapped to its Tailwind utility prefix.
 */
export function propertyPrefixes(source) {
    const start = source.indexOf('fn property_prefix(');
    const body = source.slice(start, source.indexOf('\n}', start));
    return Object.fromEntries(
        [...body.matchAll(/"([A-Za-z0-9]+)" => Some\("([^"]+)"\)/g)].map(m => [m[1], m[2]]),
    );
}

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
    const hostileSource = readFileSync(`${ROOT}packages/core/src/transform/var_hostile.rs`, 'utf8');
    const declared = new Set([
        ...rustMatchArms(hostileSource, 'is_wrong_property'),
        ...rustMatchArms(hostileSource, 'has_no_var_form'),
    ]);
    const tables = readFileSync(`${ROOT}packages/core/src/transform/generated/tables.rs`, 'utf8');
    const prefixes = propertyPrefixes(tables);
    // A boolean-only key never reaches the css-var lane — its runtime value
    // goes through `__szBoolClass` — so it is hostile in the same sense and
    // already handled. Listing it again would drop a class that works.
    const alreadyRouted = new Set(rustMatchArms(tables, 'is_boolean_only_dynamic'));
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

    const missing = [...derived].filter(key => !declared.has(key)).sort();
    const stale = [...declared].filter(key => !derived.has(key)).sort();
    if (missing.length === 0 && stale.length === 0) {
        console.log(`[var-hostile] ${declared.size} keys, all confirmed against Tailwind.`);
        return 0;
    }

    if (missing.length > 0) {
        console.error(
            '\n[var-hostile] Tailwind cannot lower a runtime value for these keys, and ' +
                'var_hostile.rs does not list them:\n  ' +
                missing.join('\n  '),
        );
    }
    if (stale.length > 0) {
        console.error(
            '\n[var-hostile] var_hostile.rs lists these, but Tailwind now lowers them ' +
                'correctly — take them off the list rather than keep warning:\n  ' +
                stale.join('\n  '),
        );
    }
    return 1;
}

process.exit(await main());
