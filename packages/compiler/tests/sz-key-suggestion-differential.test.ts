/**
 * `suggestSzKey` held to the search it replaced, over every known name, every
 * one-edit typo of each, sampled two- and three-edit typos, random strings and
 * the lengths where the budget or the search changes shape.
 *
 * The oracle (`helpers/legacy-sz-key-suggestion.ts`) is the bounded
 * three-row table that compared the key with every name; the search under
 * test reads only the names whose length is within budget and computes each
 * distance with a bit-parallel recurrence. Any difference, tie-breaking
 * included, is a changed answer.
 */
import { describe, expect, it } from 'vitest';

import { suggestSzKey } from '../src/sz-key-suggestion.js';
import { LEGACY_SZ_KEY_NAMES, legacySuggestSzKey } from './helpers/legacy-sz-key-suggestion.js';

/** Characters edits and random strings draw from: case, digits, punctuation, non-ASCII. */
const ALPHABET = [
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'0123456789',
    '-',
    '_',
    '$',
    'é',
    'ß',
    'İ',
    '😀',
];

/**
 * A seeded generator, so a failure names the same key on every run.
 *
 * @param seed - The seed.
 * @returns A function giving an integer below its bound.
 */
function random(seed: number): (bound: number) => number {
    let state = seed;
    return bound => {
        state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
        return state % bound;
    };
}

/**
 * One random edit: delete, insert, substitute or swap two neighbours.
 *
 * @param word - The text.
 * @param next - The generator.
 * @returns The edited text.
 */
function edit(word: string, next: (bound: number) => number): string {
    const at = next(word.length + 1);
    const char = ALPHABET[next(ALPHABET.length)] as string;
    switch (next(4)) {
        case 0:
            return word.slice(0, at) + word.slice(at + 1);
        case 1:
            return word.slice(0, at) + char + word.slice(at);
        case 2:
            return word.slice(0, at) + char + word.slice(at + 1);
        default:
            return at + 1 < word.length
                ? word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2)
                : word.slice(1) + word[0];
    }
}

/**
 * Every one-edit typo of a name: each deletion and swap, and at each position
 * a substitution and an insertion of `x`, of a letter of the name itself, and
 * of one drawn from {@link ALPHABET}.
 *
 * @param name - The name.
 * @param next - The generator.
 * @returns The typos.
 */
function oneEditTypos(name: string, next: (bound: number) => number): string[] {
    const out: string[] = [];
    const chars = (): string[] => [
        'x',
        name[next(name.length)] as string,
        ALPHABET[next(ALPHABET.length)] as string,
    ];
    for (let i = 0; i < name.length; i += 1) {
        out.push(name.slice(0, i) + name.slice(i + 1));
        if (i + 1 < name.length)
            out.push(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2));
        for (const char of chars()) {
            out.push(
                name.slice(0, i) + char + name.slice(i),
                name.slice(0, i) + char + name.slice(i + 1),
            );
        }
    }
    // An insertion past the last letter.
    for (const char of chars()) out.push(name + char);
    return out;
}

/**
 * Assert the search answers every key as the oracle does.
 *
 * @param keys - The keys.
 * @returns How many were checked.
 */
function expectSameAnswers(keys: Iterable<string>): number {
    let checked = 0;
    for (const key of keys) {
        const expected = legacySuggestSzKey(key);
        if (suggestSzKey(key) !== expected) {
            expect([key, suggestSzKey(key)]).toEqual([key, expected]);
        }
        checked += 1;
    }
    return checked;
}

const NAMES = LEGACY_SZ_KEY_NAMES.map(([name]) => name);
const LONGEST = Math.max(...NAMES.map(name => name.length));

describe('suggestSzKey against the search it replaced', () => {
    it('reads names that are ASCII, so lower-casing one keeps its length', () => {
        for (const name of NAMES) {
            expect([name, /^[\x20-\x7e]+$/.test(name)]).toEqual([name, true]);
        }
    });

    it('knows no name of 30 characters or more, so a pattern in budget fits one 32-bit word', () => {
        expect(LONGEST).toBeLessThan(30);
    });

    it('answers every known name, upper- and lower-cased', () => {
        const keys = NAMES.flatMap(name => [name, name.toUpperCase(), name.toLowerCase()]);

        expect(expectSameAnswers(keys)).toBe(NAMES.length * 3);
    });

    it('answers every one-edit typo of every known name', { timeout: 120_000 }, () => {
        const next = random(5);
        const keys = NAMES.flatMap(name => oneEditTypos(name, next));

        expect(expectSameAnswers(keys)).toBeGreaterThan(30_000);
    });

    it('answers sampled two- and three-edit typos', { timeout: 120_000 }, () => {
        const next = random(17);
        const keys: string[] = [];
        for (let round = 0; round < 20_000; round += 1) {
            let key = NAMES[next(NAMES.length)] as string;
            for (let edits = 2 + next(2); edits > 0; edits -= 1) key = edit(key, next);
            keys.push(key);
        }

        expect(expectSameAnswers(keys)).toBe(20_000);
    });

    it('answers random strings of every length up to past the longest name', {
        timeout: 120_000,
    }, () => {
        const next = random(23);
        const keys: string[] = [];
        for (let round = 0; round < 10_000; round += 1) {
            const length = next(LONGEST + 6);
            keys.push(Array.from({ length }, () => ALPHABET[next(ALPHABET.length)]).join(''));
        }

        expect(expectSameAnswers(keys)).toBe(10_000);
    });

    it('answers the lengths where the budget or the search changes', () => {
        const keys = [
            '',
            'a',
            'Z',
            'ab',
            'abc',
            'x'.repeat(11),
            'x'.repeat(12),
            'x'.repeat(LONGEST + 2),
            'x'.repeat(LONGEST + 3),
            // Lower-cased, `İ` is two UTF-16 units: 16 of them make a
            // 32-unit pattern, past what one 32-bit word holds.
            'İ'.repeat(16),
            'İ'.repeat(LONGEST),
            ...NAMES.filter(name => name.length >= 12).map(name => `${name.slice(0, -2)}Xy`),
            ...NAMES.filter(name => name.length === LONGEST).flatMap(name => [
                `${name}ab`,
                `${name}abc`,
            ]),
        ];

        expect(expectSameAnswers(keys)).toBe(keys.length);
    });
});
