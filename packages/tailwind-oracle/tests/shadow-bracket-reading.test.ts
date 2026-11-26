/**
 * Which value before a shadow key's slash is the shadow, and which its colour,
 * asked of the Tailwind this repository installs.
 *
 * `shadow-[…]` sets `--tw-shadow-color` when Tailwind reads the bracket as a
 * colour and `--tw-shadow` otherwise. A bracket is a colour when it starts
 * with `#` or a colour function, when the whole of it is one colour word, or
 * when its hint is `color:`; a variable, `none`, a CSS-wide keyword and any
 * bracket with a shadow's parts are the shadow. The lowering and `dynamic()`
 * read one predicate, `isShadowValue`, and the engine its mirror; each lane's
 * slash report names the member that predicate picks.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isShadowValue } from '../../compiler/src/shadow-size-keywords.js';
import { __resetSzWarnDedupForTests, transform } from '../../compiler/src/transform-core.js';
import { captureWarnings, ENGINES } from '../../compiler/tests/engine-parity-harness.js';
import { createEmittedClassOracle } from '../src/index.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

/** Brackets Tailwind reads as a colour, then ones it reads as the shadow. */
const COLOURS = [
    '[#f00]',
    '[#f00_0_1px]',
    '[red]',
    '[RED]',
    '[rebeccapurple]',
    '[canvas]',
    '[currentcolor]',
    '[transparent]',
    '[rgb(0_0_0)]',
    '[rgb(0_0_0)_0_1px]',
    '[RGB(0_0_0)]',
    '[oklch(0.5_0.1_20)]',
    '[color-mix(in_srgb,red_50%,blue)]',
    '[light-dark(red,blue)]',
    '[color:var(--s)]',
    '[color:#f00]',
];
const SHADOWS = [
    '[var(--s)]',
    '[var(--c)_0_1px]',
    '[none]',
    '[inherit]',
    '[revert-layer]',
    '[sm]',
    '[calc(1px)]',
    '[red_0_1px]',
    '[0_0_1px_red]',
    '[inset_0_1px_rgb(0_0_0)]',
    '[length:var(--c)]',
    '[shadow:0_0_1px_red]',
];

describe('a bracket before a shadow key slash, read as Tailwind reads it', async () => {
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: REPO,
    });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got: ${oracle.reason}`);

    it.each([...COLOURS.map(v => [v, false] as const), ...SHADOWS.map(v => [v, true] as const)])(
        '%s is the shadow: %s',
        (value, shadow) => {
            const [css] = oracle.cssFor([`shadow-${value}`]);
            expect(css, value).toBeTruthy();
            expect(css?.includes('--tw-shadow-color:'), css ?? '').toBe(!shadow);
            expect(isShadowValue(value)).toBe(shadow);
        },
    );

    const lanes: ReadonlyArray<readonly [string, (value: string) => string]> = [
        [
            'runtime',
            (value: string): string => {
                __resetSzWarnDedupForTests();
                const lines: string[] = [];
                const original = console.warn;
                console.warn = (...args: unknown[]) => lines.push(args.map(String).join(' '));
                try {
                    transform({ shadow: `${value}/50` } as never);
                } finally {
                    console.warn = original;
                }
                return lines.join('\n');
            },
        ],
        ...ENGINES.map(
            ([name, engine]) =>
                [
                    name,
                    (value: string): string =>
                        captureWarnings(
                            engine,
                            `export const A = () => <p sz={{ shadow: '${value}/50' }} />;`,
                            '/p/src/Shadow.jsx',
                        ).warnings.join('\n'),
                ] as const,
        ),
    ];

    it.each(lanes)('the %s lane helps a slash toward the member Tailwind reads', (_name, lower) => {
        const wrong = [...COLOURS, ...SHADOWS].filter(value => {
            const towardColour = lower(value).includes('help: write `shadowColor: {');
            return towardColour !== COLOURS.includes(value);
        });
        expect(wrong).toEqual([]);
    });
});
