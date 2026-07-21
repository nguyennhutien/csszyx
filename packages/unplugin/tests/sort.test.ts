import { describe, expect, it } from 'vitest';

import { sortStrings } from '../src/sort.js';

describe('sortStrings', () => {
    it('sorts by UTF-16 code units without dropping equal entries or mutating the input', () => {
        const input = ['b', 'a', 'a'] as const;

        expect(sortStrings(input)).toEqual(['a', 'a', 'b']);
        expect(input).toEqual(['b', 'a', 'a']);
    });
});
