/**
 * A space inside a value, on every lane.
 *
 * A class attribute splits on whitespace, so a value written with a space
 * became several names: `brightness: 'calc(1 + 0.5)'` wrote three that style
 * nothing, and a keyword key given `'flex hidden'` wrote two that do. Tailwind
 * reads `_` as the space in an arbitrary value, so each value writes one class
 * with the spaces turned into `_`, whatever the key.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/** One lane: an sz object in, its class out. */
type Lane = (sz: Record<string, unknown>) => string;

const LANES: ReadonlyArray<readonly [string, Lane]> = [
    ['runtime', sz => transform(sz as never).className],
    ...ENGINES.map(
        ([name, engine]) =>
            [
                name,
                (sz: Record<string, unknown>): string =>
                    captureWarnings(
                        engine,
                        `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`,
                        '/p/src/Space.jsx',
                    ).className ?? '',
            ] as const,
    ),
];

beforeEach(() => {
    __resetSzWarnDedupForTests();
});

describe.each(LANES)('a space inside a value — %s', (_name, lower) => {
    it.each([
        [{ brightness: 'calc(1 + 0.5)' }, 'brightness-[calc(1_+_0.5)]'],
        [{ contrast: 'calc(1 + 0.5)' }, 'contrast-[calc(1_+_0.5)]'],
        [{ saturate: 'calc(1 + 0.5)' }, 'saturate-[calc(1_+_0.5)]'],
        [{ backdropBrightness: 'calc(1 + 0.5)' }, 'backdrop-brightness-[calc(1_+_0.5)]'],
        [{ scale: 'calc(1 + 0.5)' }, 'scale-[calc(1_+_0.5)]'],
        [{ fontStretch: 'calc(50% + 10%)' }, 'font-stretch-[calc(50%_+_10%)]'],
        [{ content: 'a b' }, 'content-[a_b]'],
        [{ list: 'square inside' }, 'list-[square_inside]'],
        [{ hover: { brightness: 'calc(1 + 0.5)' } }, 'hover:brightness-[calc(1_+_0.5)]'],
    ])('%j writes %s', (sz, className) => {
        expect(lower(sz)).toBe(className);
    });

    it.each([[{ display: 'flex hidden' }], [{ position: 'absolute top' }], [{ bgRepeat: 'a b' }]])(
        '%j writes one class, never several',
        sz => {
            expect(lower(sz).split(' ')).toHaveLength(1);
        },
    );

    // The space between two classes of one variant body is not a space inside
    // a value: each wrapper hands back its classes one by one.
    it.each([
        [{ not: { hover: { p: 4, m: 2 } } }, 'not-hover:p-4 not-hover:m-2'],
        [
            { not: { supports: { 'display:grid': { p: 4, m: 2 } } } },
            'not-supports-[display:grid]:p-4 not-supports-[display:grid]:m-2',
        ],
        [{ has: { img: { p: 4, m: 2 } } }, 'has-[img]:p-4 has-[img]:m-2'],
        [
            { supports: { 'display:grid': { p: 4, m: 2 } } },
            'supports-[display:grid]:p-4 supports-[display:grid]:m-2',
        ],
    ])('%j writes each class of the variant body', (sz, className) => {
        expect(lower(sz)).toBe(className);
    });
});
