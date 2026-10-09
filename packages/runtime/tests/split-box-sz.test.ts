import { KNOWN_SPECIAL_PROPERTIES, PROPERTY_MAP, transform } from '@csszyx/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOX_ROLE_BY_KEY } from '../src/box-role-map.generated.js';
import { resetDevWarnCache } from '../src/dev-warn.js';
import {
    classify,
    classifySzKey,
    has,
    hasSz,
    omitSz,
    pickSz,
    splitBoxSz,
} from '../src/split-box.js';

describe('splitBoxSz', () => {
    it('partitions an sz object at the border line (the report case)', () => {
        expect(splitBoxSz({ m: 4, px: 2 })).toEqual({ outer: { m: 4 }, inner: { px: 2 } });
    });

    it('forces flex-item keys back to inner via options.inner', () => {
        // Item keys are outer by default; the override answers for a frame
        // that is itself the flex container laying out its one content node.
        expect(
            splitBoxSz(
                { grow: 2, self: 'center', order: 'first' },
                { inner: ['grow', 'self', 'order'] },
            ),
        ).toEqual({ outer: {}, inner: { grow: 2, self: 'center', order: 'first' } });
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
        // Special keys: lowered by a dedicated branch, no PROPERTY_MAP prefix.
        ['alignContent', 'center'],
        ['fromPos', '10%'],
        ['viaPos', '30%'],
        ['toPos', '90%'],
        ['maskComposite', 'intersect'],
        ['maskMode', 'luminance'],
        ['maskType', 'alpha'],
        ['snapStrictness', 'mandatory'],
    ];

    // Under `fallback: 'inner'` too: an unrouted outer key lands on the frame
    // by the default fallback and only reads as parity by accident.
    it.each(['outer', 'inner'] as const)(
        'routes each key to the role its compiled class is classified as (fallback %s)',
        fallback => {
            for (const [key, value] of samples) {
                const token = transform({ [key]: value })
                    .className.trim()
                    .split(/\s+/)[0];
                const stringRole = classify(token)?.role;
                const { outer } = splitBoxSz({ [key]: value }, { fallback });
                const objectRole = key in outer ? 'outer' : 'inner';
                expect(objectRole, `${key}:${value} → ${token}`).toBe(stringRole);
            }
        },
    );

    it('answers the alignment category for align-content on both sides', () => {
        expect(classifySzKey('alignContent')).toEqual({
            role: 'inner',
            category: 'alignment',
            confidence: 'exact',
        });
        expect(classify('content-center')).toMatchObject({
            role: 'inner',
            category: 'alignment',
            confidence: 'exact',
        });
        expect(has('content-between', 'alignment')).toBe(true);
        expect(
            pickSz({ alignContent: 'center', placeContent: 'center', m: 1 }, 'alignment'),
        ).toEqual({ alignContent: 'center', placeContent: 'center' });
        // `content-none` and arbitrary content stay generated content.
        expect(classify('content-none')?.category).toBe('text');
        expect(classify("content-['x']")?.category).toBe('text');
    });

    it('routes every mapped sz key to its declared role, exactly once', () => {
        for (const [key, entry] of BOX_ROLE_BY_KEY) {
            const { outer, inner } = splitBoxSz({ [key]: 1 });
            // A transition is declared on both nodes on purpose; everything
            // else lands on exactly one, and nothing is lost.
            if (entry.both) {
                expect([key in outer, key in inner], key).toEqual([true, true]);
                continue;
            }
            let bucket = 'missing';
            if (key in outer) bucket = 'outer';
            else if (key in inner) bucket = 'inner';
            expect(bucket, key).toBe(entry.role);
            expect(key in outer && key in inner, key).toBe(false);
        }
    });

    it('covers every PROPERTY_MAP key and every special key except css', () => {
        const keys = [
            ...Object.keys(PROPERTY_MAP),
            ...[...KNOWN_SPECIAL_PROPERTIES].filter(k => k !== 'css'),
        ];
        const missing = keys.filter(k => !BOX_ROLE_BY_KEY.has(k));
        expect(missing).toEqual([]);
        expect(BOX_ROLE_BY_KEY.has('css')).toBe(false);
    });
});

describe('the css key is raw CSS, routed whole by the fallback', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        resetDevWarnCache();
    });

    // Its properties can belong to either side, and splitBox cannot classify
    // the `[prop:val]` classes it compiles to, so both go to the fallback node.
    it.each(['outer', 'inner'] as const)('keeps the whole object on the %s fallback', fallback => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // `display`/`color` are inner sz keys and `opacity` an outer one, so a
        // recursion into `css` would tear it across both nodes.
        const css = { display: 'grid', color: 'red', opacity: '0.5' };
        const { outer, inner } = splitBoxSz({ css, m: 4 }, { fallback });
        const expected = fallback === 'outer' ? { css, m: 4 } : { m: 4 };
        expect(outer).toEqual(expected);
        expect(inner).toEqual(fallback === 'inner' ? { css } : {});
    });

    it('matches where splitBox puts the compiled class, under a variant too', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(splitBoxSz({ hover: { css: { color: 'red' } } })).toEqual({
            outer: { hover: { css: { color: 'red' } } },
            inner: {},
        });
    });

    it('can be placed by name', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(splitBoxSz({ css: { color: 'red' } }, { inner: ['css'] })).toEqual({
            outer: {},
            inner: { css: { color: 'red' } },
        });
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns in development that the fallback placed it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        splitBoxSz({ css: { color: 'red' } });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toMatch(
            /splitBoxSz: 'css'.*frame node.*\{ inner: \['css'\] \}/,
        );
    });

    it('is a leaf for hasSz / pickSz / omitSz', () => {
        const sz = { css: { color: 'red', opacity: '0.5' }, m: 4 };
        expect(hasSz(sz, 'inner')).toBe(false);
        expect(hasSz(sz, 'text')).toBe(false);
        expect(hasSz(sz, 'css')).toBe(true);
        expect(pickSz(sz, 'inner')).toEqual({});
        expect(pickSz(sz, 'outer')).toEqual({ m: 4 });
        expect(pickSz(sz, 'css')).toEqual({ css: { color: 'red', opacity: '0.5' } });
        expect(omitSz(sz, 'text')).toEqual(sz);
        expect(omitSz(sz, 'css')).toEqual({ m: 4 });
    });
});

describe('sz toolkit (classifySzKey / hasSz / pickSz / omitSz)', () => {
    it('classifySzKey mirrors classify on the emitted class', () => {
        // An sz key is looked up whole, so the answer is always `exact` — where
        // the class side says `prefix` for `m-4`, whose value it took on trust.
        expect(classifySzKey('m')).toEqual({
            role: 'outer',
            category: 'margin',
            confidence: 'exact',
        });
        expect(classifySzKey('px')).toEqual({
            role: 'inner',
            category: 'padding',
            confidence: 'exact',
        });
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
