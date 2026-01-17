import { describe, expect, it } from 'vitest';

import { __szColorVar } from '../src/lite.js';

describe('__szColorVar', () => {
    describe('Tailwind color names', () => {
        it('should resolve Tailwind color to CSS custom property', () => {
            expect(__szColorVar('blue-500')).toBe('var(--color-blue-500)');
        });

        it('should resolve named colors', () => {
            expect(__szColorVar('red-300')).toBe('var(--color-red-300)');
            expect(__szColorVar('green-700')).toBe('var(--color-green-700)');
            expect(__szColorVar('slate-900')).toBe('var(--color-slate-900)');
        });

        it('should resolve special names', () => {
            expect(__szColorVar('black')).toBe('var(--color-black)');
            expect(__szColorVar('white')).toBe('var(--color-white)');
            expect(__szColorVar('transparent')).toBe('var(--color-transparent)');
        });
    });

    describe('hex colors', () => {
        it('should pass through hex colors', () => {
            expect(__szColorVar('#ff0')).toBe('#ff0');
            expect(__szColorVar('#ff0000')).toBe('#ff0000');
            expect(__szColorVar('#00ff00ff')).toBe('#00ff00ff');
        });
    });

    describe('rgb colors', () => {
        it('should pass through rgb()', () => {
            expect(__szColorVar('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
        });

        it('should pass through rgba()', () => {
            expect(__szColorVar('rgba(0, 0, 0, 0.5)')).toBe('rgba(0, 0, 0, 0.5)');
        });
    });

    describe('hsl colors', () => {
        it('should pass through hsl()', () => {
            expect(__szColorVar('hsl(180, 50%, 50%)')).toBe('hsl(180, 50%, 50%)');
        });

        it('should pass through hsla()', () => {
            expect(__szColorVar('hsla(0, 0%, 0%, 0.3)')).toBe('hsla(0, 0%, 0%, 0.3)');
        });
    });

    describe('oklch colors', () => {
        it('should pass through oklch()', () => {
            expect(__szColorVar('oklch(0.7 0.15 180)')).toBe('oklch(0.7 0.15 180)');
        });
    });

    describe('CSS variables', () => {
        it('should wrap CSS variables in var()', () => {
            expect(__szColorVar('--my-color')).toBe('var(--my-color)');
            expect(__szColorVar('--theme-primary')).toBe('var(--theme-primary)');
        });
    });
});
