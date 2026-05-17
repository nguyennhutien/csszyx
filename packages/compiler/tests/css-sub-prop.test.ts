/**
 * Tests for `css: {}` — arbitrary CSS sub-prop.
 *
 * `css: {}` is the escape hatch for CSS properties with no sz/Tailwind equivalent.
 * Each key-value pair generates a Tailwind arbitrary-property class: [prop:value].
 *
 * Keys are camelCase CSS properties; the compiler converts them to kebab-case.
 * CSS custom properties (--*) are passed through unchanged.
 */

import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const t = (obj: Parameters<typeof transform>[0]): string => transform(obj).className;

describe('css: {} — arbitrary CSS sub-prop', () => {
    describe('basic camelCase → kebab-case conversion', () => {
        it('single property', () => {
            expect(t({ css: { writingMode: 'vertical-lr' } })).toBe('[writing-mode:vertical-lr]');
        });

        it('multiple properties', () => {
            const result = t({ css: { writingMode: 'vertical-lr', touchAction: 'none' } });
            expect(result).toContain('[writing-mode:vertical-lr]');
            expect(result).toContain('[touch-action:none]');
        });

        it('single-word property (no camelCase)', () => {
            expect(t({ css: { cursor: 'crosshair' } })).toBe('[cursor:crosshair]');
        });

        it('multi-word camelCase property', () => {
            expect(t({ css: { contentVisibility: 'auto' } })).toBe('[content-visibility:auto]');
        });
    });

    describe('CSS custom properties (--var)', () => {
        it('passes through --var unchanged', () => {
            expect(t({ css: { '--my-color': 'red' } })).toBe('[--my-color:red]');
        });

        it('handles --var alongside regular props', () => {
            const result = t({ css: { '--brand': '#3b82f6', writingMode: 'vertical-lr' } });
            expect(result).toContain('[--brand:#3b82f6]');
            expect(result).toContain('[writing-mode:vertical-lr]');
        });
    });

    describe('combined with regular sz props', () => {
        it('css alongside regular props', () => {
            const result = t({ p: 4, css: { writingMode: 'vertical-lr' } });
            expect(result).toContain('p-4');
            expect(result).toContain('[writing-mode:vertical-lr]');
        });

        it('css with bg and hover', () => {
            const result = t({ bg: 'blue-500', css: { touchAction: 'none' } });
            expect(result).toContain('bg-blue-500');
            expect(result).toContain('[touch-action:none]');
        });
    });

    describe('inside variants', () => {
        it('css inside hover variant', () => {
            const result = t({ hover: { css: { cursor: 'crosshair' } } });
            expect(result).toBe('hover:[cursor:crosshair]');
        });

        it('css inside focus variant', () => {
            const result = t({ focus: { css: { outline: 'none' } } });
            expect(result).toBe('focus:[outline:none]');
        });

        it('css inside responsive breakpoint', () => {
            const result = t({ md: { css: { writingMode: 'vertical-lr' } } });
            expect(result).toBe('md:[writing-mode:vertical-lr]');
        });

        it('css inside dark variant', () => {
            const result = t({ dark: { css: { colorScheme: 'dark' } } });
            expect(result).toBe('dark:[color-scheme:dark]');
        });
    });

    describe('value normalisation', () => {
        it('spaces in values are replaced by underscores', () => {
            expect(t({ css: { gridTemplateColumns: 'repeat(3, 1fr)' } })).toBe(
                '[grid-template-columns:repeat(3,_1fr)]',
            );
        });

        it('numeric values are converted to strings', () => {
            expect(t({ css: { zIndex: 10 } })).toBe('[z-index:10]');
        });
    });

    describe('edge cases', () => {
        it('empty css object produces no classes', () => {
            expect(t({ p: 4, css: {} })).toBe('p-4');
        });

        it('null/undefined values inside css are skipped', () => {
            const result = t({
                css: { writingMode: 'vertical-lr', touchAction: null as unknown as string },
            });
            expect(result).toBe('[writing-mode:vertical-lr]');
        });
    });
});
