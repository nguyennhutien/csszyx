/**
 * The engine's merge against the runtime's, on generated objects and tables.
 *
 * The engine applies a merge table with a port of the loop `_szcn` runs, so
 * the two are one rule in two languages and must not drift. Each case lowers
 * a generated `sz` array without a table, draws a random table over the
 * classes it emitted, and asks both artifacts for the merged class list; the
 * runtime, handed the same table and the unmerged list, is the oracle.
 *
 * The properties below hold whatever the table says, so they are checked on
 * the same cases without an oracle:
 *
 * - the merged list is a subsequence of the unmerged one;
 * - a class the table gives no signature is never removed by another;
 * - merging the merged list again changes nothing;
 * - the stylesheet prefix commutes with the merge.
 *
 * A failing case is shrunk to the fewest array elements that still fail, and
 * reported with its seed and index. Replay with `SZ_FUZZ_SEED` and widen with
 * `SZ_FUZZ_CASES`.
 */
import { describe, expect, it } from 'vitest';

import {
    createRng,
    fuzzBudget,
    generateSzObject,
    loadSzPool,
} from '../../core/tests/helpers/sz-fuzz.js';
import { _szcn } from '../../runtime/src/merge-classes.js';
import { registerMergeSignatures } from '../../runtime/src/merge-signatures.js';
import type { EngineMergeTable, SzObject } from '../src/index.js';
import { ENGINES } from './engine-parity-harness.js';

const POOL = loadSzPool(['hover', 'md', 'dark']);
const { seed: SEED, cases: CASES } = fuzzBudget(300);

/** One generated case: the array elements and the table's randomness. */
interface Case {
    elements: SzObject[];
    tableSeed: number;
}

/**
 * The class list one engine emits for an `sz` array, or null when the array
 * did not lower to one static class list.
 *
 * @param transform - The engine.
 * @param elements - The array's elements.
 * @param options - Table and prefix.
 * @param options.mergeTable - The table to apply, if any.
 * @param options.classPrefix - The stylesheet prefix, if any.
 * @returns The classes, in order.
 */
function lower(
    transform: (typeof ENGINES)[number][1],
    elements: readonly SzObject[],
    options: { mergeTable?: EngineMergeTable; classPrefix?: string } = {},
): string[] | null {
    const sz = `[${elements.map(element => JSON.stringify(element)).join(', ')}]`;
    const code = transform(`export const A = () => <div sz={${sz}} />;`, 'a.tsx', options).code;
    const match = /className="([^"]*)"/.exec(code ?? '');
    return match ? (match[1] as string).split(' ').filter(Boolean) : null;
}

/**
 * A random table over some classes: some get no signature, some share one,
 * and a row may cover any ids, name its own, or be missing.
 *
 * @param classes - The classes the table may sign.
 * @param tableSeed - Seed for the table's randomness.
 * @returns The table in the engine's shape.
 */
function randomTable(classes: readonly string[], tableSeed: number): EngineMergeTable {
    const rng = createRng(tableSeed);
    const ids = Math.max(1, Math.ceil(classes.length / 2));
    const signatures: Record<string, number> = {};
    for (const className of new Set(classes)) {
        if (rng() < 0.25) continue;
        signatures[className] = Math.floor(rng() * ids);
    }
    // One row short now and then: a signature past the end covers nothing.
    const rows = rng() < 0.2 ? ids - 1 : ids;
    const coverage: number[][] = [];
    for (let row = 0; row < rows; row += 1) {
        const covered: number[] = [];
        for (let id = 0; id < ids; id += 1) {
            if (rng() < 0.3) covered.push(id);
        }
        coverage.push(covered);
    }
    return { format: 1, signatures, coverage };
}

/**
 * What the runtime makes of a class list under a table.
 *
 * @param table - The table, in the engine's shape.
 * @param classes - The classes, in order.
 * @returns The merged classes.
 */
function runtimeMerge(table: EngineMergeTable, classes: readonly string[]): string[] {
    registerMergeSignatures([
        table.signatures as Record<string, number>,
        table.coverage as number[][],
    ]);
    return _szcn(classes.join(' ')).split(' ').filter(Boolean);
}

/**
 * Whether one list is a subsequence of another.
 *
 * @param part - The candidate subsequence.
 * @param whole - The list it must appear in, in order.
 * @returns True when every element of `part` appears in `whole` in order.
 */
function isSubsequence(part: readonly string[], whole: readonly string[]): boolean {
    let index = 0;
    for (const item of whole) {
        if (item === part[index]) index += 1;
    }
    return index === part.length;
}

/**
 * Every law one case breaks on one engine, named.
 *
 * @param transform - The engine.
 * @param testCase - The case.
 * @returns The broken laws, or an empty list.
 */
function violations(transform: (typeof ENGINES)[number][1], testCase: Case): string[] {
    const plain = lower(transform, testCase.elements);
    if (plain === null || plain.length === 0) return [];
    const table = randomTable(plain, testCase.tableSeed);
    const merged = lower(transform, testCase.elements, { mergeTable: table });
    const broken: string[] = [];
    if (merged === null) return ['the table changed whether the array lowered statically'];

    const expected = runtimeMerge(table, plain);
    if (merged.join(' ') !== expected.join(' ')) {
        broken.push(
            `differs from _szcn: engine "${merged.join(' ')}", runtime "${expected.join(' ')}"`,
        );
    }
    if (!isSubsequence(merged, plain)) broken.push('not a subsequence of the unmerged list');
    for (const className of plain) {
        if (!(className in table.signatures) && !merged.includes(className)) {
            broken.push(`removed "${className}", which has no signature`);
        }
    }
    if (runtimeMerge(table, merged).join(' ') !== merged.join(' ')) {
        broken.push('merging the merged list again changed it');
    }

    const prefixedPlain = lower(transform, testCase.elements, { classPrefix: 'tw' });
    // Only where the prefix is a plain `tw:` before each class; the prefix's
    // own spelling rules are not what this checks.
    if (prefixedPlain?.join(' ') === plain.map(className => `tw:${className}`).join(' ')) {
        const prefixedTable: EngineMergeTable = {
            ...table,
            signatures: Object.fromEntries(
                Object.entries(table.signatures).map(([className, id]) => [`tw:${className}`, id]),
            ),
        };
        const prefixed = lower(transform, testCase.elements, {
            mergeTable: prefixedTable,
            classPrefix: 'tw',
        });
        if (prefixed?.join(' ') !== merged.map(className => `tw:${className}`).join(' ')) {
            broken.push('the prefix does not commute with the merge');
        }
    }
    return broken;
}

/**
 * The fewest array elements that still break a law.
 *
 * @param transform - The engine.
 * @param testCase - A failing case.
 * @returns A failing case no element can be removed from.
 */
function shrink(transform: (typeof ENGINES)[number][1], testCase: Case): Case {
    let current = testCase;
    let progressed = true;
    while (progressed) {
        progressed = false;
        for (let index = 0; index < current.elements.length; index += 1) {
            const candidate = {
                ...current,
                elements: current.elements.filter((_, at) => at !== index),
            };
            if (violations(transform, candidate).length > 0) {
                current = candidate;
                progressed = true;
                break;
            }
        }
    }
    return current;
}

describe('the object rule, engine against runtime', () => {
    it(`agrees with _szcn and keeps every law over ${CASES} cases (seed ${SEED})`, () => {
        const rng = createRng(SEED);
        let checked = 0;
        let removing = 0;
        for (let index = 0; index < CASES; index += 1) {
            const length = 1 + Math.floor(rng() * 4);
            const testCase: Case = {
                elements: Array.from({ length }, () =>
                    generateSzObject(rng, POOL, { maxKeys: 3, maxVariantDepth: 1 }),
                ),
                tableSeed: Math.floor(rng() * 2 ** 32),
            };
            for (const [name, transform] of ENGINES) {
                const plain = lower(transform, testCase.elements);
                if (plain !== null) {
                    checked += 1;
                    const table = randomTable(plain, testCase.tableSeed);
                    const merged = lower(transform, testCase.elements, { mergeTable: table });
                    if (merged !== null && merged.length < plain.length) removing += 1;
                }
                const broken = violations(transform, testCase);
                if (broken.length > 0) {
                    const smallest = shrink(transform, testCase);
                    expect.fail(
                        `${name}, seed ${SEED}, case ${index}: ${violations(transform, smallest).join('; ')}\n` +
                            `  sz: ${JSON.stringify(smallest.elements)}\n` +
                            `  table seed: ${smallest.tableSeed}`,
                    );
                }
            }
        }
        // A generator that stopped reaching static lowering would pass on
        // nothing, and one whose tables stopped covering anything would hold
        // the engine to `_szcn` on lists neither of them changes.
        expect(checked).toBeGreaterThan(CASES);
        expect(removing, `${removing} of ${checked} checks removed a class`).toBeGreaterThan(
            checked / 4,
        );
    }, 120_000);
});
