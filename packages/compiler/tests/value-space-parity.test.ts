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

/**
 * Each code point JavaScript's `\s` or Unicode White_Space holds, as hex: the
 * two sets differ, and a lane reading the wrong one writes a different class.
 */
const SPACE_CANDIDATES: string[] = [];
for (let code = 0; code <= 0xffff; code++) {
    const char = String.fromCharCode(code);
    if (/\s/.test(char) || /\p{White_Space}/u.test(char)) {
        SPACE_CANDIDATES.push(code.toString(16).toUpperCase().padStart(4, '0'));
    }
}

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
        // Unicode White_Space, the set the engine splits on: a NEL is a space,
        // a BOM is not, though JavaScript's `\s` holds them the other way.
        [{ content: 'a\u0085b' }, 'content-[a_b]'],
        [{ content: 'a\uFEFFb' }, 'content-[a\uFEFFb]'],
        [{ content: 'a\u0085\u00a0\u3000b' }, 'content-[a_b]'],
    ])('%j writes %s', (sz, className) => {
        expect(lower(sz)).toBe(className);
    });

    // Every character either set holds, so the lanes read one set: the
    // engine's `char::is_whitespace` is Unicode White_Space.
    it.each(SPACE_CANDIDATES)('U+%s inside a value is a space only if White_Space', hex => {
        const char = String.fromCodePoint(Number.parseInt(hex, 16));
        const expected = /\p{White_Space}/u.test(char) ? 'content-[a_b]' : `content-[a${char}b]`;
        expect(lower({ content: `a${char}b` })).toBe(expected);
    });

    // The same set at either end of a value, inside an arbitrary value, a
    // background image and an arbitrary variant: each reads it on its own.
    it.each(SPACE_CANDIDATES)(
        'U+%s is whitespace only if White_Space, wherever it is read',
        hex => {
            const c = String.fromCodePoint(Number.parseInt(hex, 16));
            const space = /\p{White_Space}/u.test(c);
            // `content` keeps a space at either end: it is part of the string.
            expect(lower({ content: `${c}a${c}` })).toBe(
                space ? 'content-[_a_]' : `content-[${c}a${c}]`,
            );
            expect(lower({ willChange: `${c}a${c}b${c}` })).toBe(
                space ? 'will-change-[a_b]' : `will-change-[${c}a${c}b${c}]`,
            );
            expect(lower({ bgImg: `${c}none${c}` })).toBe(
                space ? 'bg-none' : `bg-[url(${c}none${c})]`,
            );
            expect(lower({ css: { willChange: `${c}a${c}b${c}` } })).toBe(
                space ? '[will-change:a_b]' : `[will-change:${c}a${c}b${c}]`,
            );
            expect(lower({ [`[&${c}>span]`]: { p: 4 } })).toBe(
                space ? '[&>span]:p-4' : `[&${c}>span]:p-4`,
            );
        },
    );

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

describe('the class a closed-enum line names', () => {
    // The note names the class the lanes emit: a spaced value is one class
    // with `_`, so `flex hidden` is never in the DOM to look for.
    const note = 'the class `flex_hidden` is still emitted';

    it('is the emitted class on the runtime', () => {
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
        try {
            expect(transform({ display: 'flex hidden' } as never).className).toBe('flex_hidden');
        } finally {
            console.warn = original;
        }
        expect(warnings.join('\n')).toContain(note);
    });

    it.each(ENGINES)('is the emitted class on the %s engine', (_name, engine) => {
        const run = captureWarnings(
            engine,
            `export const A = () => <p sz={{ display: 'flex hidden' }} />;`,
            '/p/src/Space.jsx',
        );
        expect(run.className).toBe('flex_hidden');
        expect(run.warnings.join('\n')).toContain(note);
    });
});
