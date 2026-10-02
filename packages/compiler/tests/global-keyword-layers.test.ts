/**
 * A stand-alone keyword key and its group keys across layers, spreads,
 * duplicate keys and runtime values.
 *
 * In one object the later key wins (`global-keyword-order.property.test.ts`).
 * These are the shapes that hand the lowering an order the author did not
 * write: an sz array or an `szv` merge, where a later layer overrides a key an
 * earlier layer already holds; a spread override, which keeps the overridden
 * key at its old place; duplicate keys in a `.jsx` file; a moved value the
 * static collectors used to miss; and a runtime value, whose order the build
 * cannot settle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deepMergeSzObjects, setSzWarnLocation, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

/**
 * Run one JSX module through an engine artifact.
 * @param engine - The artifact.
 * @param sz - The `sz` attribute expression, as written.
 * @returns The captured run.
 */
function jsx(engine: Parameters<typeof captureWarnings>[0], sz: string) {
    return captureWarnings(
        engine,
        `export const A = ({ c, m }) => <p sz={${sz}} />;`,
        '/p/src/Layers.jsx',
    );
}

describe('a later layer overrides a key an earlier layer holds', () => {
    it('the merge settles the family, and every key keeps its place', () => {
        const merged = deepMergeSzObjects(
            { contain: 'strict', containPaint: true },
            { contain: 'none' },
        );

        expect(Object.keys(merged)).toEqual(['contain']);
        expect(merged.contain).toBe('none');
        expect(
            Object.keys(
                deepMergeSzObjects({ touchPanX: 'x', touchPanY: 'up' }, { touchPanX: 'left' }),
            ),
        ).toEqual(['touchPanX', 'touchPanY']);
        // Merging an object with itself changes nothing it lowers to.
        expect(
            Object.keys(
                deepMergeSzObjects({ p: 2, m: 1, hover: { p: 1 } }, { p: 4, hover: { m: 2 } }),
            ),
        ).toEqual(['p', 'm', 'hover']);
    });

    it('the merge keeps the stand-alone keyword beside an inactive later group', () => {
        expect(deepMergeSzObjects({ contain: 'strict' }, { containPaint: false })).toEqual({
            contain: 'strict',
            containPaint: false,
        });
    });

    it('the merge drops the stand-alone keyword a later group replaces', () => {
        const merged = deepMergeSzObjects({ touch: 'auto' }, { touchPanX: 'x' });

        expect(merged).toEqual({ touchPanX: 'x' });
        expect(
            deepMergeSzObjects({ md: { contain: 'strict' } }, { md: { containPaint: true } }),
        ).toEqual({ md: { containPaint: true } });
    });

    it.each(ENGINES)('%s lets a later stand-alone keyword win in an sz array', (_name, engine) => {
        const contain = jsx(
            engine,
            "[{ contain: 'strict', containPaint: true }, { contain: 'none' }]",
        );
        const touch = jsx(engine, "[{ touch: 'auto' }, { touchPanX: 'x' }, { touch: 'none' }]");
        const group = jsx(engine, "[{ contain: 'strict' }, { containPaint: true }]");

        expect(contain.className).toBe('contain-none');
        expect(touch.className).toBe('touch-none');
        expect(group.className).toBe('contain-paint');
        expect([...contain.warnings, ...touch.warnings, ...group.warnings]).toEqual([]);
    });

    it.each(ENGINES)(
        '%s keeps the layers of a conditional array in order for szcn',
        (_name, engine) => {
            const run = jsx(
                engine,
                "[{ contain: 'strict', containPaint: true }, c && { contain: 'none' }]",
            );

            // Later wins in szcn's merge, so `c` true settles on `contain-none`,
            // as the static array does. Each layer is lowered, and checked, on
            // its own: in the first one `containPaint` replaces `contain`.
            expect(run.result.code).toContain('_szcn("contain-paint", c && "contain-none")');
            expect(run.warnings).toEqual([
                spreadShape('contain', 'strict', 'containPaint', ' at /p/src/Layers.jsx:1'),
            ]);
        },
    );

    it('runtime lowers an sz array the same way', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const layers: Array<[object[], string]> = [
            [[{ contain: 'strict', containPaint: true }, { contain: 'none' }], 'contain-none'],
            [[{ touch: 'auto' }, { touchPanX: 'x' }, { touch: 'none' }], 'touch-none'],
            [[{ contain: 'strict' }, { containPaint: true }], 'contain-paint'],
        ];
        for (const [sz, want] of layers) {
            const merged = sz.reduce((a, b) => deepMergeSzObjects(a as never, b as never));
            expect(transform(merged as never).className, JSON.stringify(sz)).toBe(want);
        }
        expect(warn).not.toHaveBeenCalled();
    });
});

/**
 * The warning a stand-alone key before one of its groups produces.
 * @param global - The stand-alone key.
 * @param value - Its value.
 * @param group - The group key written after it.
 * @param at - The ` at file:line` suffix, or empty.
 * @returns The message.
 */
const spreadShape = (global: string, value: string, group: string, at = '') =>
    `[csszyx] "${global}: ${value}"${at} comes before "${group}" in one sz object, so ${group} ` +
    `replaces it and the ${global} value styles nothing. A spread override ` +
    `({ ...base, ${global}: '${value}' }) leaves this order; to override, layer it: ` +
    `sz={[base, { ${global}: '${value}' }]}.`;

describe('a stand-alone key written before a group key of its family', () => {
    it('runtime names the shape a spread override leaves, once, in production too', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('NODE_ENV', 'production');
        const base = { contain: 'strict', containPaint: true };

        expect(transform({ ...base, contain: 'content' }).className).toBe('contain-paint');
        transform({ ...base, contain: 'content' });

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            spreadShape('contain', 'content', 'containPaint'),
        ]);
    });

    it('runtime names the location when it knows it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('src/Over.tsx:9');
        try {
            transform({ touch: 'auto', touchPinchZoom: true });
            transform({ normalCase: true });
        } finally {
            setSzWarnLocation(undefined);
        }

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            spreadShape('touch', 'auto', 'touchPinchZoom', ' at src/Over.tsx:9'),
            '[csszyx] "normalCase" boolean sugar was removed at src/Over.tsx:9. Use { textTransform: \'none\' } instead, or run `csszyx migrate`.',
        ]);
    });

    it('runtime stays quiet under CSSZYX_QUIET_SZ_WARNINGS', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');

        expect(transform({ nums: 'normal', numFigure: 'lining' }).className).toBe('lining-nums');
        expect(warn).not.toHaveBeenCalled();
    });

    it.each(ENGINES)('%s names it with the position', (_name, engine) => {
        const run = jsx(
            engine,
            "{ touch: 'manipulation', touchPanY: 'up', md: { nums: 'normal', numSpacing: 'tabular' } }",
        );

        expect(run.className).toBe('touch-pan-up md:tabular-nums');
        expect(run.warnings).toEqual([
            spreadShape('touch', 'manipulation', 'touchPanY', ' at /p/src/Layers.jsx:1'),
            spreadShape('nums', 'normal', 'numSpacing', ' at /p/src/Layers.jsx:1'),
        ]);
    });

    it.each(ENGINES)('%s says nothing when the stand-alone key comes last', (_name, engine) => {
        const run = jsx(engine, "{ touchPanY: 'up', touch: 'manipulation' }");

        expect(run.className).toBe('touch-manipulation');
        expect(run.warnings).toEqual([]);
    });
});

describe('duplicate keys in a .jsx object', () => {
    // `{ contain: 'strict', containPaint: true, contain: 'size' }` is, in
    // JavaScript, `{ contain: 'size', containPaint: true }`: the first place,
    // the last value. The model then lets `containPaint`, written after it,
    // replace `contain`.
    it.each(ENGINES)('%s reads the last value at the first place', (_name, engine) => {
        const run = jsx(engine, "{ contain: 'strict', containPaint: true, contain: 'size' }");
        // JSON reads a repeated key as an object literal does.
        const runtime = JSON.parse('{"contain":"strict","containPaint":true,"contain":"size"}');

        expect(runtime).toEqual({ contain: 'size', containPaint: true });
        expect(Object.keys(runtime)).toEqual(['contain', 'containPaint']);
        expect(run.className).toBe('contain-paint');
        expect(run.warnings).toEqual([
            spreadShape('contain', 'size', 'containPaint', ' at /p/src/Layers.jsx:1'),
        ]);
    });

    it.each(ENGINES)('%s emits only the last value of a repeated keyword key', (_name, engine) => {
        const run = jsx(engine, "{ containLayout: true, contain: 'none', contain: 'strict' }");

        expect(run.className).toBe('contain-strict');
        expect(run.warnings).toEqual([]);
    });
});

describe('a moved value where the static pass used to miss it', () => {
    const moved = (value: string, key: string, replacement: string) =>
        `"touch: ${value}" moved to { ${key}: ${replacement} } at /p/src/Layers.jsx:1`;

    it.each(ENGINES)('%s names it in a property-level ternary', (_name, engine) => {
        const run = jsx(
            engine,
            "{ touch: m ? 'pan-x' : 'auto', md: { touch: m ? 'none' : 'pan-y' } }",
        );

        expect(run.warnings.join('\n')).toContain(moved('pan-x', 'touchPanX', "'x'"));
        expect(run.warnings.join('\n')).toContain(moved('pan-y', 'touchPanY', "'y'"));
    });

    it.each(ENGINES)('%s names it in a nullable ternary', (_name, engine) => {
        const run = jsx(engine, "{ touch: m ? 'pan-left' : undefined }");

        expect(run.warnings.join('\n')).toContain(moved('pan-left', 'touchPanX', "'left'"));
    });

    it.each(ENGINES)('%s names it in a parametric variant', (_name, engine) => {
        const run = jsx(
            engine,
            "{ group: { hover: { touch: 'pan-right' } }, peer: { focus: { touch: 'pan-up' } }, data: { open: { touch: 'pan-down' } }, aria: { expanded: { touch: 'pinch-zoom' } }, has: { img: { md: { touch: 'pan-x' } } }, not: { hover: { touch: 'pan-y' } } }",
        );
        const warnings = run.warnings.join('\n');

        expect(warnings).toContain(moved('pan-right', 'touchPanX', "'right'"));
        expect(warnings).toContain(moved('pan-up', 'touchPanY', "'up'"));
        expect(warnings).toContain(moved('pan-down', 'touchPanY', "'down'"));
        expect(warnings).toContain(moved('pinch-zoom', 'touchPinchZoom', 'true'));
        expect(warnings).toContain(moved('pan-x', 'touchPanX', "'x'"));
        expect(warnings).toContain(moved('pan-y', 'touchPanY', "'y'"));
    });

    it.each(ENGINES)('%s names it in a conditional object branch', (_name, engine) => {
        const run = jsx(engine, "{ hover: m ? { touch: 'pan-x' } : {} }");

        expect(run.warnings.join('\n')).toContain(moved('pan-x', 'touchPanX', "'x'"));
    });
});

describe('a runtime value beside the other side of its family', () => {
    const layered = (dynamic: string, other: string, first: string, second: string) =>
        `[csszyx] "${dynamic}" takes a runtime value beside "${other}" in one sz object at ` +
        "/p/src/Layers.jsx:1, so the build cannot settle them by the object's order: both " +
        "classes can ship, and Tailwind's stylesheet order picks the one that applies. Layer " +
        `them, later wins: sz={[{ ${first}: … }, { ${second}: … }]}.`;

    it.each(ENGINES)('%s reports a group key with a runtime value', (_name, engine) => {
        const run = jsx(engine, "{ touch: 'none', touchPanX: c ? 'x' : undefined }");

        expect(run.warnings).toEqual([layered('touchPanX', 'touch', 'touch', 'touchPanX')]);
    });

    it.each(ENGINES)('%s reports a runtime boolean on a group flag', (_name, engine) => {
        const run = jsx(engine, "{ md: { contain: 'strict', containPaint: c } }");

        expect(run.warnings).toEqual([
            layered('containPaint', 'contain', 'contain', 'containPaint'),
        ]);
    });

    it.each(ENGINES)('%s reports a stand-alone key with a runtime value', (_name, engine) => {
        const run = jsx(engine, "{ contain: c ? 'strict' : 'none', containPaint: true }");

        expect(run.warnings).toEqual([
            layered('contain', 'containPaint', 'contain', 'containPaint'),
        ]);
    });

    it.each(ENGINES)('%s reports two runtime values once', (_name, engine) => {
        const run = jsx(
            engine,
            "{ numSpacing: m ? 'tabular' : 'proportional', nums: c ? 'normal' : undefined }",
        );

        expect(run.warnings).toEqual([layered('numSpacing', 'nums', 'numSpacing', 'nums')]);
    });

    it.each(ENGINES)('%s stays quiet without the other side', (_name, engine) => {
        const run = jsx(
            engine,
            "{ touchPanX: c ? 'x' : undefined, touchPanY: 'up', containPaint: c }",
        );

        expect(run.warnings).toEqual([]);
    });
});

describe('a value that belongs to a sibling group', () => {
    const sibling = (key: string, value: string, bare: string, fix: string, values: string) =>
        `[csszyx] "${key}: ${value}" at /p/src/Layers.jsx:1 is not a ${key} value. The class ` +
        `"${bare}" it emits belongs to { ${fix} }: write that key, so it combines with the other ` +
        `groups instead of resetting them. ${key} takes one of: ${values}.`;

    it.each(ENGINES)('%s names the group key', (_name, engine) => {
        const run = jsx(
            engine,
            "{ contain: 'paint', md: { nums: 'tabular' }, lg: { contain: 'inline-size' } }",
        );

        expect(run.className).toBe('contain-paint md:tabular-nums lg:contain-inline-size');
        expect(run.warnings).toEqual([
            sibling(
                'contain',
                'paint',
                'contain-paint',
                'containPaint: true',
                'none, strict, content',
            ),
            sibling('nums', 'tabular', 'tabular-nums', "numSpacing: 'tabular'", 'normal'),
            sibling(
                'contain',
                'inline-size',
                'contain-inline-size',
                "containSize: 'inline-size'",
                'none, strict, content',
            ),
        ]);
    });

    it.each(ENGINES)('%s does not claim a class the later group replaced', (_name, engine) => {
        const run = jsx(engine, "{ contain: 'layout', containSize: 'size' }");

        expect(run.className).toBe('contain-size');
        expect(run.warnings).toEqual([
            spreadShape('contain', 'layout', 'containSize', ' at /p/src/Layers.jsx:1'),
        ]);
    });

    it('runtime names the group key', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('src/Sibling.tsx:3');
        try {
            expect(transform({ nums: 'oldstyle' }).className).toBe('oldstyle-nums');
            expect(String(warn.mock.calls[0]?.[0])).toContain(
                "belongs to { numFigure: 'oldstyle' }: write that key",
            );
            warn.mockClear();
            expect(transform({ contain: 'style' }).className).toBe('contain-style');
        } finally {
            setSzWarnLocation(undefined);
        }

        expect(String(warn.mock.calls[0]?.[0])).toBe(
            sibling(
                'contain',
                'style',
                'contain-style',
                'containStyle: true',
                'none, strict, content',
            ).replace(' at /p/src/Layers.jsx:1', ' at src/Sibling.tsx:3'),
        );
    });
});

describe('replaced, moved and removed keys print everywhere, once', () => {
    it('runtime warns about a replaced flag in a browser production build', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubGlobal('window', {});
        try {
            expect(transform({ ordinal: true }).className).toBe('');
            transform({ ordinal: true });
            expect(transform({ touch: 'pan-left' }).className).toBe('');
            expect(transform({ inlineFlex: true }).className).toBe('');
        } finally {
            vi.unstubAllGlobals();
        }

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            '[csszyx] "ordinal" was replaced. Use { numOrdinal: true } instead, or run `csszyx migrate`.',
            '[csszyx] "touch: pan-left" moved to { touchPanX: \'left\' }. Run `csszyx migrate` to rewrite it.',
            '[csszyx] "inlineFlex" boolean sugar was removed. Use { display: \'inline-flex\' } instead, or run `csszyx migrate`.',
        ]);
    });

    it('runtime stays quiet about them under CSSZYX_QUIET_SZ_WARNINGS', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');

        expect(transform({ slashedZero: true, touch: 'pan-right', tableRow: true }).className).toBe(
            '',
        );
        expect(warn).not.toHaveBeenCalled();
    });

    it.each(ENGINES)('%s says a replaced flag was replaced', (_name, engine) => {
        const run = jsx(engine, '{ slashedZero: true }');

        expect(run.warnings).toEqual([
            '[csszyx] "slashedZero" was replaced at /p/src/Layers.jsx:1. Use { numSlashedZero: true } instead, or run `csszyx migrate`.',
        ]);
    });
});

describe('an alias holding a value that moved', () => {
    it.each(ENGINES)('%s names where the value went', (_name, engine) => {
        const run = jsx(engine, "{ touchAction: 'pan-x' }");

        expect(run.className ?? '').toBe('');
        expect(run.warnings).toEqual([
            '[csszyx] "touchAction: pan-x" moved to { touchPanX: \'x\' } at /p/src/Layers.jsx:1. Run `csszyx migrate` to rewrite it.',
        ]);
    });

    it('runtime names where the value went', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(transform({ touchAction: 'pan-down' }).className).toBe('');
        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            '[csszyx] "touchAction: pan-down" moved to { touchPanY: \'down\' }. Run `csszyx migrate` to rewrite it.',
        ]);
    });
});
