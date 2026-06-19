/**
 * Tests for transform module.
 */

import { describe, expect, it, vi } from 'vitest';

import { isValidSzProp, normalizeClassName, transform } from '../src/transform.js';

describe('transform', () => {
    it('should transform simple properties', () => {
        const result = transform({ p: 4, m: 2 });
        expect(result.className).toBe('p-4 m-2');
    });

    it('should transform string values', () => {
        const result = transform({ bg: 'red-500', text: 'white' });
        expect(result.className).toBe('bg-red-500 text-white');
    });

    it('should transform a kept boolean shorthand to its class', () => {
        const result = transform({ truncate: true, grow: true });
        expect(result.className).toBe('truncate grow');
    });

    it('should skip boolean false values', () => {
        const result = transform({ p: 4, m: 2, grow: false });
        expect(result.className).toBe('p-4 m-2');
    });

    it('should skip null and undefined values', () => {
        const result = transform({
            p: 4,
            m: null as unknown as number,
            gap: undefined as unknown as number,
        });
        expect(result.className).toBe('p-4');
    });

    it('should handle nested objects (variants)', () => {
        const result = transform({
            p: 4,
            hover: { bg: 'blue-500' },
        });
        expect(result.className).toBe('p-4 hover:bg-blue-500');
    });

    it('should handle multiple nested levels', () => {
        const result = transform({
            p: 4,
            hover: {
                bg: 'blue-500',
                focus: { bg: 'green-500' },
            },
        });
        expect(result.className).toBe('p-4 hover:bg-blue-500 hover:focus:bg-green-500');
    });

    it('should handle complex object with mixed types', () => {
        const result = transform({
            p: 4,
            bg: 'red-500',
            display: 'flex',
            hidden: false,
            hover: {
                bg: 'blue-600',
                text: 'white',
            },
        });
        expect(result.className).toBe('p-4 bg-red-500 flex hover:bg-blue-600 hover:text-white');
    });

    it('should handle empty object', () => {
        const result = transform({});
        expect(result.className).toBe('');
    });

    it('should preserve custom prefixes', () => {
        const result = transform({ bg: 'blue-500' }, 'hover:');
        expect(result.className).toBe('hover:bg-blue-500');
    });
});

describe('isValidSzProp', () => {
    it('should return true for valid objects', () => {
        expect(isValidSzProp({ p: 4 })).toBe(true);
        expect(isValidSzProp({})).toBe(true);
    });

    it('should return false for null', () => {
        expect(isValidSzProp(null)).toBe(false);
    });

    it('should return false for undefined', () => {
        expect(isValidSzProp(undefined)).toBe(false);
    });

    it('should return false for arrays', () => {
        expect(isValidSzProp([])).toBe(false);
        expect(isValidSzProp([1, 2, 3])).toBe(false);
    });

    it('should return false for primitives', () => {
        expect(isValidSzProp('string')).toBe(false);
        expect(isValidSzProp(42)).toBe(false);
        expect(isValidSzProp(true)).toBe(false);
    });
});

describe('normalizeClassName', () => {
    it('should remove extra whitespace', () => {
        const result = normalizeClassName('p-4  bg-red-500   m-2');
        expect(result).toBe('p-4 bg-red-500 m-2');
    });

    it('should handle leading and trailing whitespace', () => {
        const result = normalizeClassName('  p-4 bg-red-500  ');
        expect(result).toBe('p-4 bg-red-500');
    });

    it('should handle multiple spaces between classes', () => {
        const result = normalizeClassName('p-4     bg-red-500');
        expect(result).toBe('p-4 bg-red-500');
    });

    it('should handle empty string', () => {
        const result = normalizeClassName('');
        expect(result).toBe('');
    });

    it('should handle string with only whitespace', () => {
        const result = normalizeClassName('   ');
        expect(result).toBe('');
    });
});

describe('unknown property warnings', () => {
    it('should warn for unknown property in dev mode', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({ paddingg: 4 });
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Unknown property "paddingg"'),
        );
        warnSpy.mockRestore();
    });

    it('should suggest canonical key for common aliases', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({ backgroundColor: 'blue-500' });
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Use the canonical key "bg" instead of "backgroundColor"'),
        );
        warnSpy.mockRestore();
    });

    it('should not warn for known properties', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({ p: 4, bg: 'blue-500', display: 'flex' });
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('should not warn for variant keys', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({ hover: { bg: 'blue-500' }, dark: { text: 'white' } });
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('should not warn for special properties', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({
            bgImg: { gradient: 'linear' },
            group: 'card',
            peer: 'label',
            bgPos: 'center',
            maskType: 'alpha',
        });
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
