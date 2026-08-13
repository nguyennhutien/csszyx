/**
 * Collision regression tests.
 *
 * Verifies that different sz keys never produce identical Tailwind output.
 * Each TW property group should have exactly ONE canonical sz key.
 */

import { describe, expect, it, vi } from 'vitest';

import { type SzObject, transform } from '../src/transform-core.js';

/**
 * Helper to transform an sz object and return the className string.
 * @param obj - The sz object to transform.
 * @returns The generated className string.
 */
function t(obj: SzObject): string {
    return transform(obj).className;
}

describe('Collision Regression', () => {
    describe('font: catch-all removed', () => {
        it('weight: "bold" → font-bold', () => {
            expect(t({ weight: 'bold' })).toBe('font-bold');
        });

        it('fontFamily: "sans" → font-sans', () => {
            expect(t({ fontFamily: 'sans' })).toBe('font-sans');
        });

        it('font: should emit dev warning suggesting weight or fontFamily', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            t({ font: 'bold' } as SzObject);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('weight (for font-weight) or fontFamily (for family)'),
            );
            consoleSpy.mockRestore();
        });

        it('weight and fontFamily produce different classes for same-prefix values', () => {
            // Both map to 'font' prefix but with distinct value sets
            const weight = t({ weight: 'bold' });
            const family = t({ fontFamily: 'mono' });
            expect(weight).toBe('font-bold');
            expect(family).toBe('font-mono');
            expect(weight).not.toBe(family);
        });
    });

    describe('text: restricted to font-size only', () => {
        it('text: "lg" → text-lg (font-size)', () => {
            expect(t({ text: 'lg' })).toBe('text-lg');
        });

        it('color: "white" → text-white (text color)', () => {
            expect(t({ color: 'white' })).toBe('text-white');
        });

        it('textAlign: "center" → text-center (alignment)', () => {
            expect(t({ textAlign: 'center' })).toBe('text-center');
        });

        it('text and color produce different classes', () => {
            const textSize = t({ text: 'lg' });
            const textColor = t({ color: 'white' });
            expect(textSize).not.toBe(textColor);
        });
    });

    describe('border: restricted to width only', () => {
        it('border: true → border (width)', () => {
            expect(t({ border: true })).toBe('border');
        });

        it('border: 2 → border-2 (width)', () => {
            expect(t({ border: 2 })).toBe('border-2');
        });

        it('borderColor: "red-500" → border-red-500 (color)', () => {
            expect(t({ borderColor: 'red-500' })).toBe('border-red-500');
        });

        it('borderStyle: "dashed" → border-dashed (style)', () => {
            expect(t({ borderStyle: 'dashed' })).toBe('border-dashed');
        });
    });

    describe('borderCollapse: no collision with border', () => {
        it('borderCollapse: "collapse" → border-collapse', () => {
            expect(t({ borderCollapse: 'collapse' })).toBe('border-collapse');
        });

        it('borderCollapse: "separate" → border-separate', () => {
            expect(t({ borderCollapse: 'separate' })).toBe('border-separate');
        });
    });

    describe('insetShadowColor: maps correctly', () => {
        it('insetShadowColor: "red-500" → inset-shadow-red-500', () => {
            expect(t({ insetShadowColor: 'red-500' })).toBe('inset-shadow-red-500');
        });

        it('insetShadowColor: "--my-color" → inset-shadow-(color:--my-color)', () => {
            expect(t({ insetShadowColor: '--my-color' })).toBe('inset-shadow-(color:--my-color)');
        });

        it('insetShadow: "sm" → inset-shadow-sm', () => {
            expect(t({ insetShadow: 'sm' })).toBe('inset-shadow-sm');
        });
    });

    describe('no two distinct keys produce the same output', () => {
        const KEY_VALUE_PAIRS: Array<[string, string, unknown]> = [
            ['weight', 'bold', 'bold'],
            ['fontFamily', 'sans', 'sans'],
            ['text', 'lg', 'lg'],
            ['color', 'white', 'white'],
            ['textAlign', 'center', 'center'],
            ['textWrap', 'balance', 'balance'],
            ['textTransform', 'uppercase', 'uppercase'],
            ['border', '2', 2],
            ['borderColor', 'red-500', 'red-500'],
            ['borderStyle', 'solid', 'solid'],
            ['borderCollapse', 'collapse', 'collapse'],
            ['shadow', 'lg', 'lg'],
            ['shadowColor', 'black', 'black'],
            ['insetShadow', 'sm', 'sm'],
            ['insetShadowColor', 'blue-500', 'blue-500'],
        ];

        for (let i = 0; i < KEY_VALUE_PAIRS.length; i++) {
            for (let j = i + 1; j < KEY_VALUE_PAIRS.length; j++) {
                const [keyA, , valA] = KEY_VALUE_PAIRS[i];
                const [keyB, , valB] = KEY_VALUE_PAIRS[j];
                const classA = t({ [keyA]: valA } as SzObject);
                const classB = t({ [keyB]: valB } as SzObject);
                // Only test if both produce non-empty output
                if (classA && classB) {
                    it(`${keyA}:${valA} (${classA}) !== ${keyB}:${valB} (${classB})`, () => {
                        expect(classA).not.toBe(classB);
                    });
                }
            }
        }
    });
});
