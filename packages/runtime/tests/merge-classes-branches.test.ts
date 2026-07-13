/**
 * Branch coverage for merge-classes.ts beyond merge-groups.test.ts (which
 * exercises szcn's per-prefix classification through classifyAmbiguousValue):
 *  - mergeClassify's `!norm` early return (a token that normalizes to '').
 *  - the memo's LRU eviction once it exceeds MEMO_MAX_ENTRIES (500).
 */
import { describe, expect, it } from 'vitest';

import { szcn } from '../src/merge-classes.js';

describe('mergeClassify: a token that normalizes to the empty string', () => {
    it('keys a bare "!" (important marker with no utility) by itself, never merged away', () => {
        // normalizeBase('!') strips the leading '!' and leaves '' — mergeClassify
        // must bail out (not classify it as some empty-string utility) so it is
        // kept verbatim rather than dropped or wrongly grouped.
        expect(szcn('!', 'p-4')).toBe('! p-4');
    });
});

describe('szcn memo eviction (LRU cap)', () => {
    it('evicts the oldest entry once the memo exceeds its cap, and stays correct after', () => {
        // Each call uses a unique, unclassifiable single token so every one is a
        // fresh cache entry (mergeUncached returns the token unchanged).
        const total = 520;
        for (let i = 0; i < total; i++) {
            expect(szcn(`tok-${i}`)).toBe(`tok-${i}`);
        }
        // The oldest entries (evicted from the 500-entry cache) must still
        // recompute correctly on a cache miss.
        expect(szcn('tok-0')).toBe('tok-0');
        expect(szcn('tok-1')).toBe('tok-1');
        // A recently-cached entry must still hit correctly too.
        expect(szcn(`tok-${total - 1}`)).toBe(`tok-${total - 1}`);
    });
});
