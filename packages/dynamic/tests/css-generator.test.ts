/**
 * Tests for css-generator module.
 * Verifies CSS rule generation for Tailwind v4 class patterns.
 */

import { describe, expect, it } from 'vitest';

import { generateCSSRule, generateDeclarations, parseVariants } from '../src/css-generator.js';

describe('parseVariants', () => {
    it('returns base tier for non-variant class', () => {
        expect(parseVariants('p-4')).toMatchObject({
            tier: 'base',
            pseudoSuffix: '',
            selectorPrefix: '',
            utility: 'p-4',
        });
    });

    it('parses hover variant', () => {
        const r = parseVariants('hover:bg-blue-500');
        expect(r.tier).toBe('base');
        expect(r.pseudoSuffix).toBe(':hover');
        expect(r.utility).toBe('bg-blue-500');
    });

    it('parses dark variant', () => {
        const r = parseVariants('dark:bg-gray-900');
        expect(r.tier).toBe('base');
        expect(r.selectorPrefix).toBe('.dark ');
        expect(r.utility).toBe('bg-gray-900');
    });

    it('parses sm breakpoint', () => {
        const r = parseVariants('sm:p-4');
        expect(r.tier).toBe('sm');
        expect(r.utility).toBe('p-4');
    });

    it('parses lg breakpoint', () => {
        const r = parseVariants('lg:p-8');
        expect(r.tier).toBe('lg');
        expect(r.utility).toBe('p-8');
    });

    it('parses stacked sm:hover variant (breakpoint first)', () => {
        const r = parseVariants('sm:hover:bg-blue-600');
        expect(r.tier).toBe('sm');
        expect(r.pseudoSuffix).toBe(':hover');
        expect(r.utility).toBe('bg-blue-600');
    });

    it('parses max-sm tier', () => {
        const r = parseVariants('max-sm:p-4');
        expect(r.tier).toBe('max-sm');
        expect(r.utility).toBe('p-4');
    });
});

describe('generateDeclarations', () => {
    // ── Spacing ──────────────────────────────────────────────────────────────

    it('generates padding from p-4', () => {
        expect(generateDeclarations('p-4')).toBe('padding: calc(var(--spacing) * 4)');
    });

    it('generates padding-inline from px-4', () => {
        expect(generateDeclarations('px-4')).toBe('padding-inline: calc(var(--spacing) * 4)');
    });

    it('generates padding-block from py-4', () => {
        expect(generateDeclarations('py-4')).toBe('padding-block: calc(var(--spacing) * 4)');
    });

    it('generates margin from m-2', () => {
        expect(generateDeclarations('m-2')).toBe('margin: calc(var(--spacing) * 2)');
    });

    it('generates width from w-4', () => {
        expect(generateDeclarations('w-4')).toBe('width: calc(var(--spacing) * 4)');
    });

    it('generates height from h-4', () => {
        expect(generateDeclarations('h-4')).toBe('height: calc(var(--spacing) * 4)');
    });

    it('generates gap from gap-4', () => {
        expect(generateDeclarations('gap-4')).toBe('gap: calc(var(--spacing) * 4)');
    });

    it('handles zero spacing', () => {
        expect(generateDeclarations('p-0')).toBe('padding: 0');
    });

    it('handles px spacing (1px)', () => {
        expect(generateDeclarations('p-px')).toBe('padding: 1px');
    });

    it('handles auto margin', () => {
        expect(generateDeclarations('m-auto')).toBe('margin: auto');
    });

    it('handles w-full', () => {
        expect(generateDeclarations('w-full')).toBe('width: 100%');
    });

    it('handles h-screen', () => {
        expect(generateDeclarations('h-screen')).toBe('height: 100vh');
    });

    it('handles fractional width w-1/2', () => {
        expect(generateDeclarations('w-1/2')).toBe('width: 50%');
    });

    it('handles fractional width w-3/4', () => {
        expect(generateDeclarations('w-3/4')).toBe('width: 75%');
    });

    it('handles arbitrary spacing p-[13px]', () => {
        expect(generateDeclarations('p-[13px]')).toBe('padding: 13px');
    });

    it('handles arbitrary spacing with spaces p-[calc(100%-2rem)]', () => {
        expect(generateDeclarations('p-[calc(100%_-_2rem)]')).toBe('padding: calc(100% - 2rem)');
    });

    it('handles size property', () => {
        expect(generateDeclarations('size-4')).toBe(
            'width: calc(var(--spacing) * 4); height: calc(var(--spacing) * 4)',
        );
    });

    // ── Colors ───────────────────────────────────────────────────────────────

    it('generates background-color from bg-blue-500', () => {
        expect(generateDeclarations('bg-blue-500')).toBe('background-color: var(--color-blue-500)');
    });

    it('generates color from text-red-300', () => {
        expect(generateDeclarations('text-red-300')).toBe('color: var(--color-red-300)');
    });

    it('generates border-color from border-gray-200', () => {
        expect(generateDeclarations('border-gray-200')).toBe('border-color: var(--color-gray-200)');
    });

    it('handles bg-white as direct keyword', () => {
        expect(generateDeclarations('bg-white')).toBe('background-color: white');
    });

    it('handles bg-transparent', () => {
        expect(generateDeclarations('bg-transparent')).toBe('background-color: transparent');
    });

    it('handles bg-[#ff6b35] arbitrary color', () => {
        expect(generateDeclarations('bg-[#ff6b35]')).toBe('background-color: #ff6b35');
    });

    it('handles color with opacity modifier bg-blue-500/50', () => {
        const result = generateDeclarations('bg-blue-500/50');
        expect(result).toContain('color-mix');
        expect(result).toContain('var(--color-blue-500)');
        expect(result).toContain('50%');
    });

    // ── Keywords ─────────────────────────────────────────────────────────────

    it('generates display flex', () => {
        expect(generateDeclarations('flex')).toBe('display: flex');
    });

    it('generates display block', () => {
        expect(generateDeclarations('block')).toBe('display: block');
    });

    it('generates display none for hidden', () => {
        expect(generateDeclarations('hidden')).toBe('display: none');
    });

    it('generates flex-direction column for flex-col', () => {
        expect(generateDeclarations('flex-col')).toBe('flex-direction: column');
    });

    it('generates align-items center for items-center', () => {
        expect(generateDeclarations('items-center')).toBe('align-items: center');
    });

    it('generates justify-content center', () => {
        expect(generateDeclarations('justify-center')).toBe('justify-content: center');
    });

    it('generates font-weight for font-bold', () => {
        expect(generateDeclarations('font-bold')).toBe('font-weight: 700');
    });

    it('generates font-weight for font-medium', () => {
        expect(generateDeclarations('font-medium')).toBe('font-weight: 500');
    });

    it('generates text-align for text-center', () => {
        expect(generateDeclarations('text-center')).toBe('text-align: center');
    });

    it('generates text-transform for uppercase', () => {
        expect(generateDeclarations('uppercase')).toBe('text-transform: uppercase');
    });

    it('generates position absolute', () => {
        expect(generateDeclarations('absolute')).toBe('position: absolute');
    });

    // ── Text size ─────────────────────────────────────────────────────────────

    it('generates font-size for text-lg', () => {
        const result = generateDeclarations('text-lg');
        expect(result).toContain('font-size: var(--text-lg)');
        expect(result).toContain('line-height');
    });

    it('generates font-size for text-base', () => {
        const result = generateDeclarations('text-base');
        expect(result).toContain('font-size: var(--text-base)');
    });

    // ── Border radius ─────────────────────────────────────────────────────────

    it('generates border-radius for rounded', () => {
        expect(generateDeclarations('rounded')).toBe('border-radius: var(--radius)');
    });

    it('generates border-radius for rounded-lg', () => {
        expect(generateDeclarations('rounded-lg')).toBe('border-radius: var(--radius-lg)');
    });

    it('generates border-radius for rounded-full', () => {
        expect(generateDeclarations('rounded-full')).toBe('border-radius: calc(infinity * 1px)');
    });

    it('generates border-radius for rounded-none', () => {
        expect(generateDeclarations('rounded-none')).toBe('border-radius: 0');
    });

    // ── Border width ──────────────────────────────────────────────────────────

    it('generates border-width: 1px for border', () => {
        expect(generateDeclarations('border')).toBe('border-width: 1px');
    });

    it('generates border-width: 2px for border-2', () => {
        expect(generateDeclarations('border-2')).toBe('border-width: 2px');
    });

    // ── Opacity ───────────────────────────────────────────────────────────────

    it('generates opacity: 0.5 for opacity-50', () => {
        expect(generateDeclarations('opacity-50')).toBe('opacity: 0.5');
    });

    it('generates opacity: 0 for opacity-0', () => {
        expect(generateDeclarations('opacity-0')).toBe('opacity: 0');
    });

    it('generates opacity: 1 for opacity-100', () => {
        expect(generateDeclarations('opacity-100')).toBe('opacity: 1');
    });

    // ── Z-index ───────────────────────────────────────────────────────────────

    it('generates z-index for z-10', () => {
        expect(generateDeclarations('z-10')).toBe('z-index: 10');
    });

    it('generates z-index auto for z-auto', () => {
        expect(generateDeclarations('z-auto')).toBe('z-index: auto');
    });

    // ── Unknown ───────────────────────────────────────────────────────────────

    it('returns empty string for unknown class', () => {
        expect(generateDeclarations('completely-unknown-class')).toBe('');
    });
});

describe('generateCSSRule', () => {
    it('generates full rule for p-4', () => {
        const rule = generateCSSRule('p-4');
        expect(rule).toBe('.p-4 { padding: calc(var(--spacing) * 4) }');
    });

    it('generates full rule for bg-blue-500', () => {
        const rule = generateCSSRule('bg-blue-500');
        expect(rule).toBe('.bg-blue-500 { background-color: var(--color-blue-500) }');
    });

    it('generates rule with :hover pseudo for hover:bg-blue-600', () => {
        const rule = generateCSSRule('hover:bg-blue-600');
        expect(rule).toBe('.hover\\:bg-blue-600:hover { background-color: var(--color-blue-600) }');
    });

    it('generates rule with .dark prefix for dark:bg-gray-900', () => {
        const rule = generateCSSRule('dark:bg-gray-900');
        expect(rule).toBe('.dark .dark\\:bg-gray-900 { background-color: var(--color-gray-900) }');
    });

    it('generates plain rule body for sm:p-4 (no @media — tier handles wrapping)', () => {
        // generateCSSRule returns the rule; the @media is added by injector.wrapForTier
        const rule = generateCSSRule('sm:p-4');
        expect(rule).toBe('.sm\\:p-4 { padding: calc(var(--spacing) * 4) }');
    });

    it('handles stacked sm:hover:bg-blue-600', () => {
        const rule = generateCSSRule('sm:hover:bg-blue-600');
        expect(rule).toContain(':hover');
        expect(rule).toContain('background-color: var(--color-blue-600)');
    });

    it('returns empty string for unknown class', () => {
        expect(generateCSSRule('unknown-xyz-class')).toBe('');
    });

    // Breakpoint cascade test — key scenario from spec
    it('produces different rules for lg, md, sm (tier determines cascade, not key order)', () => {
        // Keys sorted alphabetically by linter: lg, md, sm
        // generateCSSRule for each is independent — cascade correctness
        // is guaranteed by injector tier ordering (sheets array index), not rule content
        const lgRule = generateCSSRule('lg:p-8');
        const mdRule = generateCSSRule('md:p-6');
        const smRule = generateCSSRule('sm:p-4');

        expect(lgRule).toContain('padding: calc(var(--spacing) * 8)');
        expect(mdRule).toContain('padding: calc(var(--spacing) * 6)');
        expect(smRule).toContain('padding: calc(var(--spacing) * 4)');

        // All use the same @media wrapper approach (applied by injector tier)
        // CSS content is distinct per tier
        expect(lgRule).not.toEqual(mdRule);
        expect(mdRule).not.toEqual(smRule);
    });

    it('handles arbitrary value p-[13px]', () => {
        const rule = generateCSSRule('p-[13px]');
        expect(rule).toBe('.p-\\[13px\\] { padding: 13px }');
    });
});
