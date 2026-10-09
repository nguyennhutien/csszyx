/**
 * Three lowerings that the runtime and the engines must write alike, each
 * checked on the runtime `transform` and on every engine in `ENGINES`:
 *
 * - a negative number hoists its sign (`{ scale: -50 }` → `-scale-50`) on the
 *   keys below. The runtime hoisted only for the keys it listed and wrote
 *   `scale--50`, a class with no CSS, where the build wrote `-scale-50`;
 * - `scale: 'none'` and `scale: '3d'` lower to the named utilities;
 * - a fraction on a logical size or inset key stays bare (`block-1/2`).
 *
 * The expected classes are literals taken from the utilities Tailwind serves;
 * this file does not ask Tailwind, it pins that the lanes agree on them.
 */
import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

const KEYS = [
    ['scale', '-scale-50'],
    ['scaleX', '-scale-x-50'],
    ['scaleY', '-scale-y-50'],
    ['outlineOffset', '-outline-offset-50'],
    ['underlineOffset', '-underline-offset-50'],
    ['scrollMs', '-scroll-ms-50'],
    ['scrollMe', '-scroll-me-50'],
    ['scrollMbs', '-scroll-mbs-50'],
    ['scrollMbe', '-scroll-mbe-50'],
] as const;

describe('a negative number on a key Tailwind serves negatively', () => {
    it.each(KEYS)('%s hoists its sign at runtime', (key, expected) => {
        expect(transform({ [key]: -50 } as never).className).toBe(expected);
    });

    describe.each(ENGINES)('and on the %s engine', (_name, engine) => {
        it.each(KEYS)('%s hoists it the same way', (key, expected) => {
            const run = captureWarnings(
                engine,
                `export const A = () => <p sz={{ ${key}: -50 }} />;`,
                '/p/src/Negative.jsx',
            );

            expect(run.className).toBe(expected);
        });
    });
});

describe('the keywords `scale` serves by name', () => {
    // `scale-[none]` writes `none` into the scale variables, which no
    // transform reads; `scale-none` is the utility that removes the scale.
    it.each([
        ['none', 'scale-none'],
        ['3d', 'scale-3d'],
    ])('%s lowers to its named utility at runtime', (value, expected) => {
        expect(transform({ scale: value } as never).className).toBe(expected);
    });

    describe.each(ENGINES)('and on the %s engine', (_name, engine) => {
        it.each([
            ['none', 'scale-none'],
            ['3d', 'scale-3d'],
        ])('%s lowers to its named utility', (value, expected) => {
            const run = captureWarnings(
                engine,
                `export const A = () => <p sz={{ scale: '${value}' }} />;`,
                '/p/src/Scale.jsx',
            );

            expect(run.className).toBe(expected);
        });
    });
});

describe('a fraction on a logical size or inset key', () => {
    // Tailwind serves `block-1/2` as half the containing block; `block-[1/2]`
    // writes `block-size: 1/2`, which is not CSS. The logical keys were missing
    // from the list of keys whose fractions stay bare.
    const FRACTIONS = [
        ['blockSize', 'block-1/2'],
        ['minBlockSize', 'min-block-1/2'],
        ['maxBlockSize', 'max-block-1/2'],
        ['inlineSize', 'inline-1/2'],
        ['minInlineSize', 'min-inline-1/2'],
        ['maxInlineSize', 'max-inline-1/2'],
        ['insetS', 'inset-s-1/2'],
        ['insetE', 'inset-e-1/2'],
        ['insetBs', 'inset-bs-1/2'],
        ['insetBe', 'inset-be-1/2'],
    ] as const;

    it.each(FRACTIONS)('%s keeps the fraction bare at runtime', (key, expected) => {
        expect(transform({ [key]: '1/2' } as never).className).toBe(expected);
    });

    describe.each(ENGINES)('and on the %s engine', (_name, engine) => {
        it.each(FRACTIONS)('%s keeps it bare', (key, expected) => {
            const run = captureWarnings(
                engine,
                `export const A = () => <p sz={{ ${key}: '1/2' }} />;`,
                '/p/src/Fraction.jsx',
            );

            expect(run.className).toBe(expected);
        });
    });
});
