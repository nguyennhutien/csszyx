#!/usr/bin/env node

// Generate the migrate reverse property map by inverting the compiler's
// PROPERTY_MAP, so the two cannot drift the way a hand-written copy did.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readTableSource } from './extract-ts-tables.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outPath = path.join(repoRoot, 'packages/cli/src/migrate/generated/reverse-property-map.ts');
const check = process.argv.includes('--check');

const generated = render(build());

if (check) {
    let current = '';
    try {
        current = readFileSync(outPath, 'utf8');
    } catch {
        fail(`${path.relative(repoRoot, outPath)} is missing. Run pnpm gen:reverse-map.`);
    }
    if (current !== generated) {
        fail(
            'the generated reverse property map is stale. Run pnpm gen:reverse-map.\n' +
                'This usually means PROPERTY_MAP gained or renamed a key.',
        );
    }
    process.exit(0);
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, generated);
console.log(`[generate-reverse-property-map] Wrote ${path.relative(repoRoot, outPath)}`);

/**
 * Invert PROPERTY_MAP, resolving shared prefixes with the hand-written choices.
 *
 * @returns Prefix/sz-key pairs, sorted by prefix.
 */
function build() {
    let forward;
    let choice;
    let extra;
    let special;
    try {
        forward = readTableSource(
            path.join(repoRoot, 'packages/compiler/src/transform-core.ts'),
        ).stringObject('PROPERTY_MAP');
        const choices = readTableSource(
            path.join(repoRoot, 'packages/cli/src/migrate/prefix-choice.ts'),
        );
        choice = new Map(choices.stringObject('AMBIGUOUS_PREFIX_CHOICE'));
        extra = choices.stringObject('EXTRA_REVERSE_PREFIXES');
        special = new Set(choices.stringObject('SPECIAL_LOWERING_PREFIXES').map(([key]) => key));
    } catch (error) {
        fail(error.message);
    }

    // One prefix can be reached from several sz keys, so collect first and
    // decide after: the choice has to see every candidate to be checkable.
    const candidates = new Map();
    for (const [szKey, prefix] of forward) {
        if (!candidates.has(prefix)) candidates.set(prefix, []);
        candidates.get(prefix).push(szKey);
    }

    const entries = [];
    const undecided = [];
    for (const [prefix, keys] of candidates) {
        // A key whose lowering is not `prefix-value` cannot be reached by
        // stripping the prefix, so leaving it out is the correct answer rather
        // than an omission — class-parser reads those by value.
        if (special.has(prefix)) {
            special.delete(prefix);
            continue;
        }
        if (keys.length === 1) {
            entries.push([prefix, keys[0], null]);
            continue;
        }
        const picked = choice.get(prefix);
        if (picked === undefined) {
            undecided.push(`${prefix} (candidates: ${keys.join(', ')})`);
            continue;
        }
        if (!keys.includes(picked)) {
            fail(
                `AMBIGUOUS_PREFIX_CHOICE["${prefix}"] is "${picked}", which PROPERTY_MAP does ` +
                    `not lower to "${prefix}". Candidates: ${keys.join(', ')}.`,
            );
        }
        entries.push([prefix, picked, keys]);
        choice.delete(prefix);
    }

    if (undecided.length > 0) {
        fail(
            'these prefixes are shared by several sz keys and no choice is recorded.\n' +
                'Add each to AMBIGUOUS_PREFIX_CHOICE in packages/cli/src/migrate/prefix-choice.ts:\n  ' +
                undecided.join('\n  '),
        );
    }
    if (choice.size > 0) {
        fail(
            'AMBIGUOUS_PREFIX_CHOICE names prefixes that are no longer shared by ' +
                `several sz keys, so the choice is dead: ${[...choice.keys()].join(', ')}.`,
        );
    }

    if (special.size > 0) {
        fail(
            'SPECIAL_LOWERING_PREFIXES names prefixes PROPERTY_MAP no longer produces, ' +
                `so the exclusion is dead: ${[...special].join(', ')}.`,
        );
    }

    for (const [prefix, szKey] of extra) {
        if (candidates.has(prefix)) {
            fail(
                `EXTRA_REVERSE_PREFIXES["${prefix}"] duplicates a prefix PROPERTY_MAP already ` +
                    'produces, so it belongs in the inversion rather than the extras.',
            );
        }
        entries.push([prefix, szKey, null]);
    }

    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries;
}

/**
 * Render the generated module.
 *
 * @param entries - Prefix, chosen sz key, and the candidates when shared.
 * @returns TypeScript source.
 */
function render(entries) {
    const lines = entries.map(([prefix, szKey, shared]) => {
        const key = /^[A-Za-z_$][\w$]*$/.test(prefix) ? prefix : `'${prefix}'`;
        const note = shared === null ? '' : ` // chosen from: ${shared.join(', ')}`;
        return `    ${key}: '${szKey}',${note}`;
    });
    return `// @generated by scripts/generate-reverse-property-map.mjs
// Do not edit by hand. Run \`pnpm gen:reverse-map\`.
//
// Inverted from the compiler's PROPERTY_MAP. Where one Tailwind prefix is
// shared by several sz keys the inversion cannot pick, so the default comes
// from AMBIGUOUS_PREFIX_CHOICE in ../prefix-choice.ts and the alternatives are
// noted inline. class-parser.ts overrides the default by inspecting the value.

/** Tailwind class prefix to the sz prop name migrate should write. */
export const REVERSE_PROPERTY_MAP: Record<string, string> = {
${lines.join('\n')}
};
`;
}

/**
 * Report a generator failure and stop.
 *
 * @param message - What went wrong.
 */
function fail(message) {
    console.error(`[generate-reverse-property-map] ${message}`);
    process.exit(1);
}
