import { PROPERTY_MAP, transform } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';
import { BOX_ROLE_BY_KEY } from '../src/box-role-map.generated.js';
import { classify, classifySzKey, hasSz, omitSz, pickSz, splitBoxSz } from '../src/split-box.js';

describe('splitBoxSz', () => {
    it('partitions an sz object at the border line (the report case)', () => {
        expect(splitBoxSz({ m: 4, px: 2 })).toEqual({ outer: { m: 4 }, inner: { px: 2 } });
    });

    it('forces flex-item keys to outer via options.outer', () => {
        expect(
            splitBoxSz(
                { grow: 2, self: 'center', order: 'first' },
                { outer: ['grow', 'self', 'order'] },
            ),
        ).toEqual({ outer: { grow: 2, self: 'center', order: 'first' }, inner: {} });
    });

    it('routes a variant by the role of the property inside it', () => {
        expect(splitBoxSz({ gap: 2, hover: { px: 1 }, md: { m: 4 } })).toEqual({
            outer: { md: { m: 4 } },
            inner: { gap: 2, hover: { px: 1 } },
        });
    });

    it('splits a variant across buckets when its inner properties disagree', () => {
        expect(splitBoxSz({ md: { m: 4, px: 2 } })).toEqual({
            outer: { md: { m: 4 } },
            inner: { md: { px: 2 } },
        });
    });

    it('flattens an array of sz inputs before partitioning', () => {
        const isLoading = false;
        expect(splitBoxSz([{ m: 4 }, isLoading && { opacity: 50 }, { px: 2 }])).toEqual({
            outer: { m: 4 },
            inner: { px: 2 },
        });
        const loading = true;
        expect(splitBoxSz([{ m: 4 }, loading && { opacity: 50 }])).toEqual({
            outer: { m: 4, opacity: 50 },
            inner: {},
        });
    });

    it('deep-merges array parts last-write-wins before partitioning', () => {
        expect(splitBoxSz([{ md: { m: 2 } }, { md: { px: 4 } }])).toEqual({
            outer: { md: { m: 2 } },
            inner: { md: { px: 4 } },
        });
    });

    it('collapses null / false / undefined / empty to empty buckets', () => {
        expect(splitBoxSz(null)).toEqual({ outer: {}, inner: {} });
        expect(splitBoxSz(false)).toEqual({ outer: {}, inner: {} });
        expect(splitBoxSz(undefined)).toEqual({ outer: {}, inner: {} });
        expect(splitBoxSz({})).toEqual({ outer: {}, inner: {} });
        expect(splitBoxSz([null, false, undefined])).toEqual({ outer: {}, inner: {} });
    });

    it('routes an unknown key to the fallback (default outer, overridable)', () => {
        expect(splitBoxSz({ wat: 1 })).toEqual({ outer: { wat: 1 }, inner: {} });
        expect(splitBoxSz({ wat: 1 }, { fallback: 'inner' })).toEqual({
            outer: {},
            inner: { wat: 1 },
        });
    });

    it('inner wins when a key is forced onto both', () => {
        expect(splitBoxSz({ m: 4 }, { outer: ['m'], inner: ['m'] })).toEqual({
            outer: {},
            inner: { m: 4 },
        });
    });

    it('loses no key and duplicates none (no-loss invariant)', () => {
        const sz = { m: 4, px: 2, gap: 1, position: 'absolute', display: 'flex' };
        const { outer, inner } = splitBoxSz(sz);
        expect([...Object.keys(outer), ...Object.keys(inner)].sort()).toEqual(
            Object.keys(sz).sort(),
        );
    });

    it('throws on a raw class string in development', () => {
        expect(() => splitBoxSz('m-4 px-2')).toThrow(/raw class strings/);
    });

    it('skips prototype-polluting keys', () => {
        const hostile = JSON.parse('{ "m": 4, "__proto__": { "px": 9 } }');
        const { outer, inner } = splitBoxSz(hostile);
        expect(outer).toEqual({ m: 4 });
        expect(inner).toEqual({});
        expect(({} as Record<string, unknown>).px).toBeUndefined();
    });
});

describe('splitBoxSz parity with splitBox(compile(x))', () => {
    const samples: Array<[string, string | number]> = [
        ['m', 4],
        ['px', 2],
        ['gap', 2],
        ['grow', 1],
        ['self', 'center'],
        ['order', 'first'],
        ['opacity', 50],
        ['display', 'flex'],
        ['position', 'absolute'],
        ['w', 'full'],
        ['overflow', 'hidden'],
        ['shadow', 'lg'],
        ['rounded', 'lg'],
        ['text', 'sm'],
        ['bg', 'red-500'],
    ];

    it('routes each key to the role its compiled class is classified as', () => {
        for (const [key, value] of samples) {
            const token = transform({ [key]: value })
                .className.trim()
                .split(/\s+/)[0];
            const stringRole = classify(token)?.role;
            const { outer } = splitBoxSz({ [key]: value });
            const objectRole = key in outer ? 'outer' : 'inner';
            expect(objectRole, `${key}:${value} → ${token}`).toBe(stringRole);
        }
    });

    it('routes every mapped sz key to its declared role', () => {
        for (const [key, entry] of BOX_ROLE_BY_KEY) {
            const { outer, inner } = splitBoxSz({ [key]: 1 });
            let bucket = 'missing';
            if (key in outer) bucket = 'outer';
            else if (key in inner) bucket = 'inner';
            expect(bucket, key).toBe(entry.role);
        }
    });

    it('covers every PROPERTY_MAP key', () => {
        const missing = Object.keys(PROPERTY_MAP).filter(k => !BOX_ROLE_BY_KEY.has(k));
        expect(missing).toEqual([]);
    });
});

describe('sz toolkit (classifySzKey / hasSz / pickSz / omitSz)', () => {
    it('classifySzKey mirrors classify on the emitted class', () => {
        expect(classifySzKey('m')).toEqual({ role: 'outer', category: 'margin' });
        expect(classifySzKey('px')).toEqual({ role: 'inner', category: 'padding' });
        expect(classifySzKey('nope')).toBeUndefined();
    });

    it('hasSz selects by role, category, and exact key (recursing into variants)', () => {
        const sz = { m: 4, px: 2, gap: 1, hover: { p: 3 } };
        expect(hasSz(sz, 'inner')).toBe(true);
        expect(hasSz(sz, 'margin')).toBe(true);
        expect(hasSz(sz, 'gap')).toBe(true);
        expect(hasSz(sz, 'ring')).toBe(false);
    });

    it('pickSz / omitSz keep or drop the matching keys', () => {
        const sz = { m: 4, px: 2, gap: 1, hover: { p: 3 } };
        expect(pickSz(sz, 'outer')).toEqual({ m: 4 });
        expect(omitSz(sz, 'outer')).toEqual({ px: 2, gap: 1, hover: { p: 3 } });
        expect(pickSz(sz, 'padding')).toEqual({ px: 2, hover: { p: 3 } });
    });
});
