/**
 * `touch-action` and `contain` as one sz key per group of their grammar.
 *
 * Both spell a global keyword that stands alone, then groups that combine:
 * `touch-action: auto | none | [ pan-x|pan-left|pan-right || pan-y|pan-up|
 * pan-down || pinch-zoom ] | manipulation`, `contain: none | strict | content
 * | [ size|inline-size || layout || style || paint ]`. Tailwind keeps each
 * group in its own variable, so the group keys combine in one object and a
 * second value of a group replaces the first — the rule `num*` follows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setSzWarnLocation, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

afterEach(() => {
    vi.restoreAllMocks();
});

const KEYS: ReadonlyArray<readonly [string, string | boolean, string]> = [
    ['touch', 'auto', 'touch-auto'],
    ['touch', 'none', 'touch-none'],
    ['touch', 'manipulation', 'touch-manipulation'],
    ['touchPanX', 'x', 'touch-pan-x'],
    ['touchPanX', 'left', 'touch-pan-left'],
    ['touchPanX', 'right', 'touch-pan-right'],
    ['touchPanY', 'y', 'touch-pan-y'],
    ['touchPanY', 'up', 'touch-pan-up'],
    ['touchPanY', 'down', 'touch-pan-down'],
    ['touchPinchZoom', true, 'touch-pinch-zoom'],
    ['contain', 'none', 'contain-none'],
    ['contain', 'strict', 'contain-strict'],
    ['contain', 'content', 'contain-content'],
    ['containSize', 'size', 'contain-size'],
    ['containSize', 'inline-size', 'contain-inline-size'],
    ['containLayout', true, 'contain-layout'],
    ['containPaint', true, 'contain-paint'],
    ['containStyle', true, 'contain-style'],
];

describe('touch-action and contain keys', () => {
    it.each(KEYS)('runtime lowers %s: %s to %s', (key, value, className) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(transform({ [key]: value }).className).toBe(className);
        expect(warn).not.toHaveBeenCalled();
    });

    it.each(ENGINES)('%s combines the groups of each property', (_name, engine) => {
        const run = captureWarnings(
            engine,
            `export const A = () => (
                <p sz={{ touchPanX: 'left', touchPanY: 'down', touchPinchZoom: true, containSize: 'inline-size', containLayout: true, containPaint: true, containStyle: true, md: { touch: 'none', contain: 'strict' } }} />
            );`,
        );

        expect(run.className?.split(' ').sort()).toEqual(
            [
                'contain-inline-size',
                'contain-layout',
                'contain-paint',
                'contain-style',
                'md:contain-strict',
                'md:touch-none',
                'touch-pan-down',
                'touch-pan-left',
                'touch-pinch-zoom',
            ].sort(),
        );
        expect(run.warnings).toEqual([]);
    });

    it.each(ENGINES)('%s keeps a misspelled value on its group prefix', (_name, engine) => {
        const run = captureWarnings(
            engine,
            "export const A = () => <><p sz={{ touchPanX: 'lft', containSize: 'inline' }} /><p sz={{ contain: 'strickt' }} /></>;",
        );

        expect([...(run.result.classes ?? [])]).toEqual([
            'touch-pan-lft',
            'contain-inline',
            'contain-strickt',
        ]);
        expect(run.warnings.join('\n')).toContain('touchPanX takes one of: x, left, right');
    });

    it.each(ENGINES)('%s takes a runtime boolean on a single-keyword group', (_name, engine) => {
        const run = captureWarnings(
            engine,
            'export const A = ({ c, v }) => <p sz={{ touchPinchZoom: c, containPaint: c, containSize: v }} />;',
        );
        const code = run.result.code ?? '';

        expect(code).toContain('__szBoolClass(c, "touchPinchZoom", "touch-pinch-zoom")');
        expect(code).toContain('__szBoolClass(c, "containPaint", "contain-paint")');
        expect(run.warnings.join('\n')).toContain('"containSize" cannot take a runtime value');
    });

    it.each(ENGINES)('%s names the group key for a touch value that moved', (_name, engine) => {
        const run = captureWarnings(
            engine,
            "export const A = () => <p sz={{ touch: 'pan-x', md: { touch: 'pinch-zoom' } }} />;",
        );
        const warnings = run.warnings.join('\n');

        expect(run.className ?? '').toBe('');
        expect(warnings).toContain('"touch: pan-x" moved to { touchPanX: \'x\' }');
        expect(warnings).toContain('"touch: pinch-zoom" moved to { touchPinchZoom: true }');
    });

    it('runtime names the group key for a touch value that moved', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(transform({ touch: 'pan-up' }).className).toBe('');
        expect(String(warn.mock.calls[0]?.[0])).toContain(
            '"touch: pan-up" moved to { touchPanY: \'up\' }',
        );
    });

    it('runtime names a flag key with its location, once, and stays quiet in production', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('src/Pan.tsx:4');
        try {
            transform({ touch: 'pinch-zoom' });
            transform({ touch: 'pinch-zoom' });
        } finally {
            setSzWarnLocation(undefined);
        }
        vi.stubEnv('NODE_ENV', 'production');
        try {
            transform({ touch: 'pan-down' });
        } finally {
            vi.unstubAllEnvs();
        }

        expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
            '[csszyx] "touch: pinch-zoom" moved to { touchPinchZoom: true } at src/Pan.tsx:4. Run `csszyx migrate` to rewrite it.',
        ]);
    });

    // A global keyword stands alone in each grammar, so the object's order
    // settles it: the global resets the groups written before it, the groups
    // written after it replace it. The two are never emitted together, so the
    // result does not hang on Tailwind's sort, which puts the stand-alone
    // class after its groups whatever order they were written in.
    const ORDERED: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
        [{ contain: 'strict', containPaint: true }, 'contain-paint'],
        [{ containPaint: true, contain: 'strict' }, 'contain-strict'],
        [{ containLayout: true, contain: 'none', containPaint: true }, 'contain-paint'],
        [{ touchPanX: 'x', touchPinchZoom: true, touch: 'none' }, 'touch-none'],
        [{ touch: 'none', touchPanY: 'up', touchPinchZoom: true }, 'touch-pan-up touch-pinch-zoom'],
        [{ touch: 'auto', touchPinchZoom: false }, 'touch-auto'],
        [
            { md: { touch: 'none', touchPanX: 'left' }, touch: 'auto' },
            'md:touch-pan-left touch-auto',
        ],
    ];

    it.each(ENGINES)(
        '%s settles a global keyword and its groups by the object order',
        (_name, engine) => {
            for (const [sz, expected] of ORDERED) {
                const source = `export const A = () => <p sz={${JSON.stringify(sz)}} />;`;
                const run = captureWarnings(engine, source);
                expect(run.className, source).toBe(expected);
                expect(run.warnings, source).toEqual([]);
            }
        },
    );

    it('runtime settles a global keyword and its groups by the object order', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const [sz, expected] of ORDERED) {
            expect(transform(sz).className, JSON.stringify(sz)).toBe(expected);
        }
        expect(warn).not.toHaveBeenCalled();
    });
});
