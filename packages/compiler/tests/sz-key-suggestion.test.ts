/**
 * "Did you mean" for an unknown sz key.
 *
 * `workBreak` compiled to a class no rule matches, and the diagnostic said
 * "Unknown property" and "Check for typos" without naming the key it was one
 * edit away from. A suggestion is text beside the diagnostic, never a rewrite,
 * so the cost of a wrong one is a misleading hint; the negative controls below
 * are custom utility names a project plausibly serves with `@utility`, and each
 * must stay unanswered.
 */
import { describe, expect, it } from 'vitest';

import { nearestName, suggestSzKey } from '../src/sz-key-suggestion.js';
import { PROPERTY_MAP } from '../src/transform-core.js';
import { ENGINES } from './engine-parity-harness.js';

describe('nearestName', () => {
    const NAMES: ReadonlyArray<readonly [string, string]> = [
        ['display', 'display'],
        ['wordBreak', 'break'],
        ['roundedT', 'roundedT'],
        ['roundedB', 'roundedB'],
    ];

    it('counts a swap of two neighbouring letters as one edit', () => {
        expect(nearestName('dispaly', NAMES, 1)).toBe('display');
    });

    it('matches regardless of case and returns the target, not the name', () => {
        expect(nearestName('WORKBREAK', NAMES, 1)).toBe('break');
    });

    it('answers nothing when two different targets are equally near', () => {
        expect(nearestName('roundedX', NAMES, 1)).toBeNull();
    });

    it('answers nothing beyond the distance it was given', () => {
        expect(nearestName('dsplay', NAMES, 0)).toBeNull();
    });
});

describe('suggestSzKey', () => {
    it.each([
        ['workBreak', 'break'],
        ['pading', 'p'],
        ['dispaly', 'display'],
        ['fontWieght', 'weight'],
        ['hovr', 'hover'],
        ['bacgroundColor', 'bg'],
        ['gpa', 'gap'],
    ])('suggests %s → %s', (key, expected) => {
        expect(suggestSzKey(key)).toBe(expected);
    });

    it.each([
        'scrollbarHide',
        'noScrollbar',
        'iconSize',
        'elevation',
        'tabItemsWrapper',
        'vh',
        'roundedd',
    ])('stays silent for %s', key => {
        expect(suggestSzKey(key)).toBeNull();
    });
});

describe.each(ENGINES)('the suggestion on an unknown key — %s', (_name, transform) => {
    it('goes into the args and the message', () => {
        const source = "export const A = () => <div sz={{ workBreak: 'all' }} />;";
        const result = transform(source, '/p/src/A.tsx');

        expect(result.issues?.[0]?.args).toEqual({ key: 'workBreak', suggestion: 'break' });
        expect(result.diagnostics?.[0]).toContain('help: write `break` if you meant it;');
    });

    it('is left out when no known key is near', () => {
        const source = "export const A = () => <div sz={{ xyzzy: 'all' }} />;";
        const result = transform(source, '/p/src/A.tsx');

        expect(result.issues?.[0]?.args).toEqual({ key: 'xyzzy' });
        expect(result.diagnostics?.[0]).toContain('help: check the spelling;');
    });
});

/**
 * The textbook optimal string alignment distance, with no bound: what the
 * engine's bounded one must agree with wherever the bound matters.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns The distance.
 */
function referenceDistance(a: string, b: string): number {
    const d = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) d[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[a.length][b.length];
}

/**
 * {@link nearestName} computed from {@link referenceDistance}, for each budget.
 *
 * @param key - The name as authored.
 * @param names - Known names, each its own target.
 * @returns The answer for a budget.
 */
function referenceNearest(key: string, names: readonly string[]) {
    let best = Number.POSITIVE_INFINITY;
    let targets = new Set<string>();
    for (const name of names) {
        const distance = referenceDistance(key.toLowerCase(), name.toLowerCase());
        if (distance < best) {
            best = distance;
            targets = new Set();
        }
        if (distance === best) targets.add(name);
    }
    return (maxDistance: number) =>
        best > maxDistance || targets.size !== 1 ? null : [...targets][0];
}

describe('the bounded distance', () => {
    // Every one- and two-edit typo of a sample of real keys, against every key:
    // stopping a row early once it is past the budget must change no answer.
    const names = Object.keys(PROPERTY_MAP);
    const sample = names.filter((_, index) => index % 29 === 0);
    const typos = (key: string): string[] => {
        const out = new Set<string>();
        for (let i = 0; i < key.length; i += 1) {
            out.add(key.slice(0, i) + key.slice(i + 1));
            out.add(`${key.slice(0, i)}x${key.slice(i + 1)}`);
            out.add(`${key.slice(0, i)}q${key.slice(i)}`);
            if (i + 1 < key.length)
                out.add(key.slice(0, i) + key[i + 1] + key[i] + key.slice(i + 2));
        }
        for (const once of [...out].slice(0, 6)) out.add(`${once}zz`);
        return [...out];
    };

    it('answers as the unbounded distance does, for every budget', { timeout: 60_000 }, () => {
        const pairs = names.map(name => [name, name] as const);
        for (const key of sample) {
            for (const typo of typos(key)) {
                const reference = referenceNearest(typo, names);
                for (const budget of [0, 1, 2]) {
                    expect([typo, budget, nearestName(typo, pairs, budget)]).toEqual([
                        typo,
                        budget,
                        reference(budget),
                    ]);
                }
            }
        }
    });

    it('answers a key it was asked before the same way, past any memo bound', () => {
        const first = suggestSzKey('workBreak');
        for (let index = 0; index < 5000; index += 1) suggestSzKey(`zz${index}`);
        expect(suggestSzKey('workBreak')).toBe(first);
        expect(first).toBe('break');
    });
});
