/**
 * Tests for sortStrings — the browser-safe local copy of the compiler's
 * deterministic string sort used by hydration checksums and class-order
 * normalization. Not re-exported from the package entry, so it is imported
 * directly from its module.
 */
import { describe, expect, it } from 'vitest';

import { sortStrings } from '../src/sort.js';

describe('sortStrings', () => {
    it('sorts strings ascending by UTF-16 code unit', () => {
        expect(sortStrings(['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
    });

    it('is stable for already-equal (duplicate) entries', () => {
        // Exercises the `a === b` branch of the comparator (neither `-1` nor `1`).
        expect(sortStrings(['b', 'a', 'b', 'a'])).toEqual(['a', 'a', 'b', 'b']);
    });

    it('does not mutate the input array', () => {
        const input = ['z', 'a'];
        const result = sortStrings(input);
        expect(input).toEqual(['z', 'a']);
        expect(result).toEqual(['a', 'z']);
    });

    it('accepts any iterable, not just arrays', () => {
        expect(sortStrings(new Set(['banana', 'apple']))).toEqual(['apple', 'banana']);
    });

    it('handles an empty input', () => {
        expect(sortStrings([])).toEqual([]);
    });
});
