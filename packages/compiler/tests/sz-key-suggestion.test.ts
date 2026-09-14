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

import { nearestName, suggestSzKey, szKeySuggestionFor } from '../src/sz-key-suggestion.js';
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

describe.each(ENGINES)('szKeySuggestionFor — %s', (_name, transform) => {
    it('reads the key out of the unknown-key diagnostic the engine renders', () => {
        const source = "export const A = () => <div sz={{ workBreak: 'all' }} />;";
        const diagnostics = transform(source, '/p/src/A.tsx').diagnostics ?? [];

        expect(diagnostics.map(szKeySuggestionFor)).toContain('break');
    });

    it('suggests nothing for a diagnostic of another kind', () => {
        const source = "export const A = () => <div sz={{ backgroundColor: 'red-500' }} />;";
        const diagnostics = transform(source, '/p/src/A.tsx').diagnostics ?? [];

        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics.map(szKeySuggestionFor)).toEqual(diagnostics.map(() => null));
    });
});
