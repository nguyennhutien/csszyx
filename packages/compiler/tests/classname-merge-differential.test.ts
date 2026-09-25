/**
 * The engine's class-name merge on generated elements and tables.
 *
 * On one element a static class name loses each class that a class the `sz`
 * beside it emits covers, by signature or by coverage row, or that the `sz`
 * repeats; nothing else changes. The oracle is that filter, written out here
 * over the same table, followed by the `sz` classes the engine emits for the
 * element with no class name. The laws below hold whatever the table says:
 *
 * - what is left of the class name is a subsequence of it;
 * - a class the table gives no signature goes only as a repeat;
 * - the attribute order and the class name's whitespace change nothing;
 * - with no table, the output is the class name followed by the `sz` classes.
 *
 * A failing case is shrunk to the fewest array elements and class-name
 * classes, and reported with its seed. Replay with `SZ_FUZZ_SEED`.
 */
import { describe, expect, it } from 'vitest';

import {
    createRng,
    escapeUnsafeChars,
    fuzzBudget,
    generateSzObject,
    loadSzPool,
} from '../../core/tests/helpers/sz-fuzz.js';
import type { EngineMergeTable, SzObject } from '../src/index.js';
import { ENGINES } from './engine-parity-harness.js';
import { randomTable } from './merge-fuzz-table.js';

/** One engine's transform. */
type Transform = (typeof ENGINES)[number][1];

const POOL = loadSzPool(['hover', 'md', 'dark']);
const { seed: SEED, cases: CASES } = fuzzBudget(300);

/** Class names no key emits, which a table may or may not sign. */
const AUTHORED = ['card', 'reveal', 'js-hook', 'p-8', 'pb-2', 'hover:pb-2', 'mt-1!', 'w-4'];

/** One generated case. */
interface Case {
    elements: SzObject[];
    base: string[];
    tableSeed: number;
}

/**
 * The class list one engine emits for an element, or null when it did not
 * lower to one static class list.
 *
 * @param transform - The engine.
 * @param testCase - The element's parts.
 * @param options - How to write it, and what to hand the engine.
 * @param options.mergeTable - The table to apply, if any.
 * @param options.classNameFirst - Write `className` before `sz`.
 * @param options.separator - What joins the class name's classes.
 * @returns The classes, in order.
 */
function lower(
    transform: (typeof ENGINES)[number][1],
    testCase: Pick<Case, 'elements' | 'base'>,
    options: { mergeTable?: EngineMergeTable; classNameFirst?: boolean; separator?: string } = {},
): string[] | null {
    const sz = `sz={[${testCase.elements.map(element => escapeUnsafeChars(JSON.stringify(element))).join(', ')}]}`;
    const className =
        testCase.base.length === 0
            ? ''
            : `className="${testCase.base.join(options.separator ?? ' ')}"`;
    const attributes = options.classNameFirst ? `${className} ${sz}` : `${sz} ${className}`;
    const code = transform(`export const A = () => <div ${attributes} />;`, 'a.tsx', {
        mergeTable: options.mergeTable,
    }).code;
    const match = /className="([^"]*)"/.exec(code ?? '');
    return match ? (match[1] as string).split(' ').filter(Boolean) : null;
}

/**
 * The class name's classes an element keeps beside the given `sz` classes.
 *
 * @param table - The table.
 * @param base - The class name's classes.
 * @param over - The `sz` classes.
 * @returns What stays, in order.
 */
function filtered(
    table: EngineMergeTable,
    base: readonly string[],
    over: readonly string[],
): string[] {
    const covered = new Set<number>();
    for (const className of over) {
        const id = table.signatures[className];
        if (id === undefined) continue;
        covered.add(id);
        for (const row of table.coverage[id] ?? []) covered.add(row);
    }
    return base.filter(className => {
        const id = table.signatures[className];
        return !over.includes(className) && !(id !== undefined && covered.has(id));
    });
}

/**
 * Every law one case breaks on one engine, named.
 *
 * @param transform - The engine.
 * @param testCase - The case.
 * @returns The broken laws, or an empty list.
 */
function violations(transform: (typeof ENGINES)[number][1], testCase: Case): string[] {
    const bare = lower(transform, { elements: testCase.elements, base: [] });
    if (bare === null || bare.length === 0 || testCase.base.length === 0) return [];
    const table = randomTable([...bare, ...testCase.base], testCase.tableSeed);
    const over = lower(transform, { elements: testCase.elements, base: [] }, { mergeTable: table });
    const merged = lower(transform, testCase, { mergeTable: table });
    if (over === null || merged === null) return ['the class name changed whether sz lowered'];
    const broken: string[] = [];
    const expected = [...filtered(table, testCase.base, over), ...over];
    if (merged.join(' ') !== expected.join(' ')) {
        broken.push(`engine "${merged.join(' ')}", expected "${expected.join(' ')}"`);
    }
    const kept = merged.slice(0, merged.length - over.length);
    let index = 0;
    for (const className of testCase.base) if (className === kept[index]) index += 1;
    if (index !== kept.length)
        broken.push('what is left of the class name is not a subsequence of it');
    for (const className of testCase.base) {
        const signed = className in table.signatures;
        if (!signed && !over.includes(className) && !kept.includes(className)) {
            broken.push(`removed "${className}", which has no signature and no repeat`);
        }
    }
    const swapped = lower(transform, testCase, { mergeTable: table, classNameFirst: true });
    if (swapped?.join(' ') !== merged.join(' '))
        broken.push('the attribute order changed the output');
    const spaced = lower(transform, testCase, { mergeTable: table, separator: '  \n ' });
    if (spaced?.join(' ') !== merged.join(' '))
        broken.push('the class name’s whitespace changed the output');
    const plain = lower(transform, testCase);
    if (plain?.join(' ') !== [...testCase.base, ...bare].join(' ')) {
        broken.push('with no table the output is not the class name followed by the sz classes');
    }
    return broken;
}

/**
 * The fewest parts that still break a law.
 *
 * @param transform - The engine.
 * @param testCase - A failing case.
 * @returns A failing case no part can be removed from.
 */
function shrink(transform: (typeof ENGINES)[number][1], testCase: Case): Case {
    let current = testCase;
    let progressed = true;
    while (progressed) {
        progressed = false;
        const candidates = [
            ...current.elements.map((_, at) => ({
                ...current,
                elements: current.elements.filter((__, other) => other !== at),
            })),
            ...current.base.map((_, at) => ({
                ...current,
                base: current.base.filter((__, other) => other !== at),
            })),
        ];
        const smaller = candidates.find(candidate => violations(transform, candidate).length > 0);
        if (smaller !== undefined) {
            current = smaller;
            progressed = true;
        }
    }
    return current;
}

/**
 * One case: the `sz` of each element and the class name beside them.
 *
 * @param rng - The seeded generator.
 * @returns A fresh case.
 */
function randomCase(rng: () => number): Case {
    const elements = Array.from({ length: 1 + Math.floor(rng() * 3) }, () =>
        generateSzObject(rng, POOL, { maxKeys: 3, maxVariantDepth: 1 }),
    );
    const base = Array.from(
        { length: 1 + Math.floor(rng() * 4) },
        () => AUTHORED[Math.floor(rng() * AUTHORED.length)] as string,
    );
    return { elements, base, tableSeed: Math.floor(rng() * 2 ** 32) };
}

/**
 * Whether one engine's merge removed a class from the case, or null when the
 * `sz` emits nothing to merge against.
 *
 * @param transform - The engine.
 * @param testCase - The case; may gain a repeat of an `sz` class.
 * @param rng - The seeded generator.
 * @returns True when a class was removed.
 */
function removesOne(transform: Transform, testCase: Case, rng: () => number): boolean | null {
    const bare = lower(transform, { elements: testCase.elements, base: [] });
    if (bare === null || bare.length === 0) return null;
    // An sz class name reused in the class name is a repeat to drop.
    if (rng() < 0.2) testCase.base.push(bare[0] as string);
    const table = randomTable([...bare, ...testCase.base], testCase.tableSeed);
    const merged = lower(transform, testCase, { mergeTable: table });
    return merged !== null && merged.length < testCase.base.length + bare.length;
}

/**
 * Fail with the smallest case that still breaks a law, if this one does.
 *
 * @param name - The engine's name.
 * @param index - The case number.
 * @param transform - The engine.
 * @param testCase - The case.
 */
function expectLawsHold(name: string, index: number, transform: Transform, testCase: Case): void {
    if (violations(transform, testCase).length === 0) return;
    const smallest = shrink(transform, testCase);
    expect.fail(
        `${name}, seed ${SEED}, case ${index}: ${violations(transform, smallest).join('; ')}\n` +
            `  className: ${smallest.base.join(' ')}\n` +
            `  sz: ${JSON.stringify(smallest.elements)}\n` +
            `  table seed: ${smallest.tableSeed}`,
    );
}

describe('the class-name merge, engine against its rule', () => {
    it(`keeps every law over ${CASES} cases (seed ${SEED})`, () => {
        const rng = createRng(SEED);
        let checked = 0;
        let removing = 0;
        for (let index = 0; index < CASES; index += 1) {
            const testCase = randomCase(rng);
            for (const [name, transform] of ENGINES) {
                const removed = removesOne(transform, testCase, rng);
                if (removed !== null) checked += 1;
                if (removed === true) removing += 1;
                expectLawsHold(name, index, transform, testCase);
            }
        }
        expect(checked).toBeGreaterThan(CASES);
        expect(removing, `${removing} of ${checked} checks removed a class`).toBeGreaterThan(
            checked / 4,
        );
    }, 180_000);
});
