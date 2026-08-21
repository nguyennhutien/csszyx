#!/usr/bin/env node
// Derive the szcn collision blocklist from Tailwind, and fail when it drifts.
//
// `packages/runtime/src/merge-groups.ts` names the theme-token names that
// collide with a built-in utility. A colliding token cannot be grouped: a
// colour called `balance` would classify `text-balance` (text-wrap!) as a
// colour and merge away a different property. Membership is not a judgement
// call, so it should not be maintained as one — this asks the pinned Tailwind
// and compares.
//
// Tailwind states the collision itself. `parseCandidate` returns EVERY reading
// of a class name, and a name that is both a built-in keyword and a theme key
// comes back twice:
//
//   text-balance  → { root: 'text-balance', kind: 'static' }
//                   { root: 'text', kind: 'functional', value: 'balance' }
//   text-red-500  → { root: 'text', kind: 'functional', value: 'red-500' }
//
// One reading is a class; two readings is a class whose meaning depends on
// which one wins. That is the whole test, and it needs no CSS diffing, no
// hand-written vocabulary, and no guess at how a class splits — `border-b-red-500`
// is `border-b` + a colour to Tailwind, and reverse-engineering it by string
// prefix invents token names nobody would ever declare.
//
// SCOPE. This covers the static-versus-functional collision, which is what
// COLLISION_BLOCKLIST holds. It does NOT cover two theme namespaces feeding one
// root — `--font-bold` as a family against `--font-weight-bold` — because both
// readings are functional and Tailwind reports one candidate. merge-groups.ts
// handles that separately with AMBIGUITY_PAIRS, and this gate asserts that pair
// list is still the right shape rather than deriving it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(`${ROOT}scripts/`);
const tailwind = require('tailwindcss');

/** The class prefixes a token in each guarded category feeds. */
const CATEGORY_PREFIXES = {
    colors: [
        'text',
        'bg',
        'border',
        'decoration',
        'shadow',
        'outline',
        'ring',
        'fill',
        'stroke',
        'divide',
        'accent',
        'caret',
        'from',
        'via',
        'to',
        'inset-shadow',
        'inset-ring',
        'placeholder',
    ],
    textSizes: ['text'],
    fontFamilies: ['font'],
    fontWeights: ['font'],
};

/**
 * Load one stylesheet through Tailwind's own resolver.
 *
 * @param id - Import specifier.
 * @param base - Importing file's base.
 * @returns The stylesheet Tailwind asked for.
 */
async function loadStylesheet(id, base) {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id, {
        paths: [ROOT],
    });
    return { base, path, content: readFileSync(path, 'utf8') };
}

/**
 * Names Tailwind reads two ways under one of the guarded prefixes.
 *
 * @returns Category to colliding names.
 */
async function derive() {
    const design = await tailwind.__unstable__loadDesignSystem('@import "tailwindcss";', {
        base: ROOT,
        loadStylesheet,
    });

    const prefixes = new Set(Object.values(CATEGORY_PREFIXES).flat());
    /** @type {Map<string, Set<string>>} prefix to ambiguous names. */
    const byPrefix = new Map([...prefixes].map(prefix => [prefix, new Set()]));

    for (const entry of design.getClassList()) {
        const cls = Array.isArray(entry) ? entry[0] : entry;
        const readings = [...design.parseCandidate(cls)];
        // A static reading of the WHOLE name, beside a functional one under a
        // guarded prefix, is the collision. Anything with one reading is a
        // plain utility and anything static-only is a keyword no token feeds.
        const isStatic = readings.some(
            reading => reading.kind === 'static' && reading.root === cls,
        );
        if (!isStatic) continue;
        for (const reading of readings) {
            if (reading.kind !== 'functional') continue;
            if (!byPrefix.has(reading.root)) continue;
            const value = reading.value;
            if (value?.kind !== 'named') continue;
            byPrefix.get(reading.root).add(value.value);
        }
    }

    const derived = {};
    for (const [category, categoryPrefixes] of Object.entries(CATEGORY_PREFIXES)) {
        derived[category] = new Set(
            categoryPrefixes.flatMap(prefix => [...(byPrefix.get(prefix) ?? [])]),
        );
    }
    return derived;
}

/**
 * The blocklist as `merge-groups.ts` declares it.
 *
 * @returns Category to declared names.
 */
function declared() {
    const source = readFileSync(`${ROOT}packages/runtime/src/merge-groups.ts`, 'utf8');

    // Resolve one `const NAME = new Set([...])` to its string members.
    const literal = name => {
        const match = new RegExp(String.raw`const ${name} = new Set\(\[([\s\S]*?)\]\)`).exec(
            source,
        );
        if (!match) throw new Error(`merge-groups.ts no longer declares ${name}`);
        return [...match[1].matchAll(/'([^']+)'/g)].map(entry => entry[1]);
    };

    // Read the composition out of COLLISION_BLOCKLIST rather than restating it.
    // Listing the constants here too would mean every new one has to be added
    // in two files, and the gate would keep passing while missing the addition
    // — the exact drift it exists to catch.
    const blockStart = source.indexOf('const COLLISION_BLOCKLIST');
    if (blockStart === -1)
        throw new Error('merge-groups.ts no longer declares COLLISION_BLOCKLIST');
    const block = source.slice(blockStart, source.indexOf('\n};', blockStart));

    const sets = {};
    for (const entry of block.matchAll(/^\s{4}(\w+): new Set\(([\s\S]*?)\),$/gm)) {
        const [, category, body] = entry;
        const names = [
            ...[...body.matchAll(/\.\.\.(\w+)/g)].flatMap(spread => literal(spread[1])),
            ...[...body.matchAll(/'([^']+)'/g)].map(inline => inline[1]),
        ];
        sets[category] = new Set(names);
    }
    for (const category of Object.keys(CATEGORY_PREFIXES)) {
        if (!sets[category]) throw new Error(`COLLISION_BLOCKLIST no longer covers ${category}`);
    }
    return sets;
}

/**
 * Report what Tailwind says the blocklist should hold.
 *
 * @returns Process exit code.
 */
async function main() {
    const derived = await derive();
    const declaredSets = declared();
    let total = 0;
    const problems = [];

    for (const category of Object.keys(CATEGORY_PREFIXES)) {
        const listed = declaredSets[category];
        total += listed.size;
        const missing = [...derived[category]].filter(name => !listed.has(name)).sort();
        if (missing.length > 0) {
            problems.push(
                `\n[szcn-blocklist] Tailwind reads these ${category} names two ways, and ` +
                    'merge-groups.ts does not block them — a project token by that name would ' +
                    'make szcn group on a property the class does not set:\n  ' +
                    missing.join('\n  '),
            );
        }
    }

    // Deliberately one-directional. A name the blocklist holds but Tailwind no
    // longer reads twice costs a missed grouping opportunity; a name it misses
    // costs a wrong merge, which is a rendered defect. Only the second fails.
    if (problems.length === 0) {
        console.log(
            `[szcn-blocklist] ${total} names across ${Object.keys(CATEGORY_PREFIXES).length} ` +
                'categories, all confirmed against Tailwind.',
        );
        return 0;
    }
    for (const problem of problems) console.error(problem);
    return 1;
}

process.exit(await main());
