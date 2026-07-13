/**
 * Additional branch coverage for concatenate.ts beyond concatenate.test.ts:
 * the mangle-map "not found" fallback, the single-falsy-argument fast path,
 * mid-array empty results in the multi-arg loops (both _sz and _szMerge),
 * an array as the first multi-arg element, and the _sz3 only-last-truthy case.
 */
import { describe, expect, it } from 'vitest';

import { _sz, _sz3, _szMerge } from '../src/concatenate.js';

describe('mangle map fallback for an unmapped class', () => {
    it('keeps the original class name when it is absent from the active map', () => {
        (globalThis as any).__csszyx_ssr_mangle_map = { 'p-4': 'a0' };
        try {
            // bg-blue-500 is not in the map, so it must pass through unmangled
            // while p-4 (which is) gets rewritten — exercises the `|| c` fallback.
            const res = _sz([{ p: 4, bg: 'blue-500' }]);
            expect(res).toBe('a0 bg-blue-500');
        } finally {
            delete (globalThis as any).__csszyx_ssr_mangle_map;
        }
    });
});

describe('_sz single-argument fast path with a falsy non-array value', () => {
    it('returns "" for a single null argument', () => {
        expect(_sz(null)).toBe('');
    });

    it('returns "" for a single false argument', () => {
        expect(_sz(false)).toBe('');
    });

    it('returns "" for a single undefined argument', () => {
        expect(_sz(undefined)).toBe('');
    });
});

describe('_sz multi-argument loop with a mid-array empty result', () => {
    it('skips an array argument that resolves to an empty string', () => {
        expect(_sz('a', [], 'b')).toBe('a b');
        expect(_sz('a', [false, null], 'b')).toBe('a b');
    });

    it('skips an object argument that compiles to an empty className', () => {
        expect(_sz('a', {}, 'b')).toBe('a b');
    });

    it('does not add a leading space when the first multi-arg element is an array', () => {
        expect(_sz(['a', 'b'], 'c')).toBe('a b c');
    });
});

describe('_szMerge multi-argument loop with a mid-array empty result', () => {
    it('skips an array argument that resolves to an empty string', () => {
        expect(_szMerge('a', [], 'b')).toBe('a b');
    });

    it('skips an object argument that compiles to an empty className', () => {
        expect(_szMerge('a', {}, 'b')).toBe('a b');
    });
});

describe('_sz3 with only the last argument truthy', () => {
    it('adds no leading space before the sole class', () => {
        expect(_sz3('', '', 'c')).toBe('c');
    });
});
