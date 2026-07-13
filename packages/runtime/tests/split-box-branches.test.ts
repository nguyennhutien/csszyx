/**
 * Remaining split-box.ts branch coverage beyond split-box.test.ts /
 * split-box-sz.test.ts: bare (no-suffix) prefix tokens, exact-base and
 * object-selector matching, the sz-object depth guard and forbidden-key
 * skip in each of mergeSzInto/partitionSz/filterSz/hasSz's internal scan,
 * an all-whitespace string sz input, and hasSz recursing through an
 * unrecognized wrapper key to find a match deeper.
 */
import { SzDepthError } from '@csszyx/compiler/browser';
import { describe, expect, it } from 'vitest';

import { classify, has, hasSz, omitSz, pickSz, splitBoxSz } from '../src/split-box.js';

function nestObject(n: number): Record<string, unknown> {
    let o: Record<string, unknown> = { p: 4 };
    for (let i = 0; i < n; i++) {
        o = { hover: o };
    }
    return o;
}

function nestArray(n: number): unknown[] {
    let a: unknown = [{ p: 4 }];
    for (let i = 0; i < n; i++) {
        a = [a];
    }
    return a as unknown[];
}

describe('inspect() per-token memo eviction (INSPECT_MEMO_MAX cap)', () => {
    it('clears the memo once it fills, and stays correct afterward', () => {
        // Each distinct arbitrary-value token is its own memo entry; classify()
        // returns undefined for all of them (not csszyx-owned), so this both
        // fills the cache past its cap and proves classification still works
        // correctly once the clear-and-refill has happened.
        for (let i = 0; i < 4200; i++) {
            expect(classify(`not-owned-${i}`)).toBeUndefined();
        }
        expect(classify('m-4')).toEqual({ role: 'outer', category: 'margin' });
    });
});

describe('bare (no-suffix) prefix token', () => {
    it('classifies a bare multi-part-prefix token with an empty value segment', () => {
        // 'inset' (no numeric suffix) matches the `inset` PREFIX entry itself
        // (base === prefix), distinct from `inset-2` (base.startsWith('inset-')).
        expect(classify('inset')).toEqual({ role: 'outer', category: 'position' });
    });
});

describe('matches(): exact base===selector and object selectors', () => {
    it('matches when the selector equals the token base exactly (not just a prefix)', () => {
        expect(has('flex', 'flex')).toBe(true);
    });
});

describe('sz-object toolkit: object selector and "content" alias', () => {
    it('matchesKey with an object selector checks category membership only', () => {
        expect(hasSz({ bg: 'red-500' }, { bg: 'irrelevant-value' })).toBe(true);
        expect(hasSz({ bg: 'red-500' }, { margin: 'x' })).toBe(false);
    });

    it('an object selector against an unowned key short-circuits to false', () => {
        expect(hasSz({ notCsszyxOwned: 1 }, { margin: 'x' })).toBe(false);
    });

    it('"content" selects inner-role keys, mirroring the string toolkit', () => {
        expect(pickSz({ m: 4, px: 2 }, 'content')).toEqual({ px: 2 });
        expect(omitSz({ m: 4, px: 2 }, 'content')).toEqual({ m: 4 });
    });
});

describe('hasSz recurses through an unrecognized wrapper key', () => {
    it('finds a match nested inside a key csszyx does not own', () => {
        expect(hasSz({ customWrapper: { m: 4 } }, 'margin')).toBe(true);
        expect(hasSz({ customWrapper: { display: 'flex' } }, 'margin')).toBe(false);
    });
});

describe('splitBoxSz on an all-whitespace string', () => {
    it('collapses to empty buckets without throwing (nothing to partition)', () => {
        expect(splitBoxSz('   \t  ')).toEqual({ outer: {}, inner: {} });
    });
});

describe('sz-object depth guard (mergeSzInto / partitionSz / filterSz / hasSz scan)', () => {
    it('splitBoxSz throws SzDepthError on an array merge nested past MAX_SZ_DEPTH', () => {
        expect(() => splitBoxSz(nestArray(40) as never)).toThrow(SzDepthError);
    });

    it('splitBoxSz throws SzDepthError when partitioning a too-deeply-nested object', () => {
        expect(() => splitBoxSz(nestObject(40) as never)).toThrow(SzDepthError);
    });

    it('splitBoxSz throws SzDepthError inside mergeSzInto itself when two array parts recursively merge past the limit', () => {
        // A single deeply-nested part alone only recurses through flattenSz's own
        // guard (and, for a plain object, partitionSz's). Two OVERLAPPING deeply
        // nested parts force mergeSzInto's own key-by-key merge recursion deep,
        // exercising its independent depth guard.
        const a = nestObject(40);
        const b = nestObject(40);
        expect(() => splitBoxSz([a, b] as never)).toThrow(SzDepthError);
    });

    it('pickSz/omitSz throw SzDepthError on a too-deeply-nested object', () => {
        expect(() => pickSz(nestObject(40) as never, 'padding')).toThrow(SzDepthError);
        expect(() => omitSz(nestObject(40) as never, 'padding')).toThrow(SzDepthError);
    });

    it('hasSz throws SzDepthError on a too-deeply-nested object', () => {
        expect(() => hasSz(nestObject(40) as never, 'padding')).toThrow(SzDepthError);
    });
});

describe('forbidden key skip inside array-merge (mergeSzInto)', () => {
    it('skips a __proto__ key introduced by merging a second array element', () => {
        const hostile = JSON.parse('{"__proto__":{"px":9}}');
        const { outer, inner } = splitBoxSz([{ m: 4 }, hostile]);
        expect(outer).toEqual({ m: 4 });
        expect(inner).toEqual({});
        expect(({} as Record<string, unknown>).px).toBeUndefined();
    });
});

describe('forbidden key skip inside filterSz (pickSz/omitSz) and hasSz scan', () => {
    it('pickSz/omitSz skip a __proto__ key rather than throwing or polluting', () => {
        const hostile = JSON.parse('{ "m": 4, "__proto__": { "px": 9 } }');
        expect(pickSz(hostile, 'outer')).toEqual({ m: 4 });
        expect(omitSz(hostile, 'outer')).toEqual({});
        expect(({} as Record<string, unknown>).px).toBeUndefined();
    });

    it('hasSz skips a __proto__ key rather than throwing or polluting', () => {
        const hostile = JSON.parse('{ "m": 4, "__proto__": { "gap": 9 } }');
        expect(hasSz(hostile, 'margin')).toBe(true);
        expect(hasSz(hostile, 'gap')).toBe(false);
        expect(({} as Record<string, unknown>).gap).toBeUndefined();
    });
});
