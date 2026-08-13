/**
 * Tests for CSS variable type hints (Tailwind v4).
 *
 * When a CSS variable is used as a value for properties where the prefix
 * is shared/ambiguous, a type hint is added so Tailwind knows the intent.
 */

import { describe, expect, it } from 'vitest';

import { type SzObject, transform } from '../src/transform-core.js';

/**
 * Helper to transform an sz object and return the className string.
 * @param obj - The sz object to transform.
 * @returns The generated className string.
 */
function t(obj: SzObject): string {
    return transform(obj).className;
}

describe('CSS Variable Type Hints', () => {
    describe('ambiguous properties get type hints', () => {
        it('fontFamily: "--custom-font" → font-(family-name:--custom-font)', () => {
            expect(t({ fontFamily: '--custom-font' })).toBe('font-(family-name:--custom-font)');
        });

        it('weight: "--my-weight" → font-(weight:--my-weight)', () => {
            expect(t({ weight: '--my-weight' })).toBe('font-(weight:--my-weight)');
        });

        it('text: "--my-text-size" → text-(length:--my-text-size)', () => {
            expect(t({ text: '--my-text-size' })).toBe('text-(length:--my-text-size)');
        });
    });

    describe('unambiguous properties keep simple syntax', () => {
        it('color: "--my-color" → text-(--my-color)', () => {
            expect(t({ color: '--my-color' })).toBe('text-(--my-color)');
        });

        it('bg: "--my-bg" → bg-(--my-bg)', () => {
            expect(t({ bg: '--my-bg' })).toBe('bg-(--my-bg)');
        });

        it('borderColor: "--my-border" → border-(--my-border)', () => {
            expect(t({ borderColor: '--my-border' })).toBe('border-(--my-border)');
        });

        it('p: "--spacing" → p-(--spacing)', () => {
            expect(t({ p: '--spacing' })).toBe('p-(--spacing)');
        });

        it('gap: "--my-gap" → gap-(--my-gap)', () => {
            expect(t({ gap: '--my-gap' })).toBe('gap-(--my-gap)');
        });
    });

    describe('non-variable values are unaffected', () => {
        it('fontFamily: "sans" → font-sans (no type hint)', () => {
            expect(t({ fontFamily: 'sans' })).toBe('font-sans');
        });

        it('weight: "bold" → font-bold (no type hint)', () => {
            expect(t({ weight: 'bold' })).toBe('font-bold');
        });

        it('text: "lg" → text-lg (no type hint)', () => {
            expect(t({ text: 'lg' })).toBe('text-lg');
        });
    });

    describe('type hints in variants', () => {
        it('hover fontFamily CSS var → hover:font-(family-name:--font)', () => {
            expect(t({ hover: { fontFamily: '--font' } })).toBe('hover:font-(family-name:--font)');
        });

        it('dark text CSS var → dark:text-(length:--size)', () => {
            expect(t({ dark: { text: '--size' } })).toBe('dark:text-(length:--size)');
        });
    });
});
