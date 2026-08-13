/**
 * Tests for text/leading shorthand merging.
 *
 * When both `text` and `leading` are specified, they should be merged
 * into a single Tailwind class: text-{size}/{leading}.
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

describe('Text/Leading Shorthand', () => {
    describe('basic merging', () => {
        it('text + leading number → text-lg/7', () => {
            expect(t({ text: 'lg', leading: 7 })).toBe('text-lg/7');
        });

        it('text + leading keyword → text-sm/tight', () => {
            expect(t({ text: 'sm', leading: 'tight' })).toBe('text-sm/tight');
        });

        it('text + leading none → text-base/none', () => {
            expect(t({ text: 'base', leading: 'none' })).toBe('text-base/none');
        });

        it('text + leading relaxed → text-xl/relaxed', () => {
            expect(t({ text: 'xl', leading: 'relaxed' })).toBe('text-xl/relaxed');
        });
    });

    describe('no merging when only one is present', () => {
        it('text alone → text-lg', () => {
            expect(t({ text: 'lg' })).toBe('text-lg');
        });

        it('leading alone → leading-7', () => {
            expect(t({ leading: 7 })).toBe('leading-7');
        });
    });

    describe('merging with other properties', () => {
        it('text + leading + other props', () => {
            const result = t({ p: 4, text: 'lg', leading: 7, color: 'white' });
            expect(result).toContain('text-lg/7');
            expect(result).toContain('p-4');
            expect(result).toContain('text-white');
            expect(result).not.toContain('leading-7');
        });

        it('color + leading — color must NOT merge with leading (regression)', () => {
            // Bug: text-(.+) regex was too broad, causing text-emerald-300 (color)
            // to be merged with leading-relaxed → text-emerald-300/relaxed (invalid)
            const result = t({ color: 'emerald-300', leading: 'relaxed' });
            expect(result).toContain('text-emerald-300');
            expect(result).toContain('leading-relaxed');
            expect(result).not.toContain('text-emerald-300/relaxed');
        });

        it('text + color + leading — only text-size merges, color stays separate', () => {
            const result = t({ text: 'sm', color: 'emerald-300', leading: 'relaxed' });
            expect(result).toContain('text-sm/relaxed');
            expect(result).toContain('text-emerald-300');
            expect(result).not.toContain('text-emerald-300/relaxed');
            expect(result).not.toContain('leading-relaxed');
        });

        it('leading consumed only once when multiple text-size classes present', () => {
            // Edge case: two text-size classes + one leading — leading merges with first match only
            const result = t({ text: 'sm', leading: 5, hover: { text: 'lg' } });
            expect(result).toContain('text-sm/5');
            expect(result).toContain('hover:text-lg');
            expect(result).not.toContain('leading-5');
        });
    });

    describe('merging within variants', () => {
        it('text + leading inside hover variant → hover:text-lg/7', () => {
            expect(t({ hover: { text: 'lg', leading: 7 } })).toBe('hover:text-lg/7');
        });

        it('text + leading inside responsive variant → md:text-sm/5', () => {
            expect(t({ md: { text: 'sm', leading: 5 } })).toBe('md:text-sm/5');
        });
    });
});
