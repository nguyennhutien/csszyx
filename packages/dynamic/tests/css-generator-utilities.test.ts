/**
 * Branch coverage for generateDeclarations — the utility → CSS declaration map.
 *
 * The existing css-generator suite covers spacing/sizing/color; this exercises
 * the many remaining utility families (opacity, z, border, radius, type, layout,
 * transforms) and their special cases (none/auto/full/first/last/[arbitrary]).
 */
import { describe, expect, it } from 'vitest';

import { generateCSSRule, generateDeclarations, parseVariants } from '../src/css-generator.js';

describe('generateDeclarations — utility families', () => {
    it.each([
        // opacity
        ['opacity-50', 'opacity:'],
        ['opacity-[0.33]', 'opacity: 0.33'],
        // z-index
        ['z-10', 'z-index: 10'],
        ['z-auto', 'z-index: auto'],
        ['z-[100]', 'z-index: 100'],
        // border width
        ['border', 'border-width: 1px'],
        ['border-t', 'border-top-width: 1px'],
        ['border-x', 'border-inline-width: 1px'],
        ['border-2', 'border-width: 2px'],
        ['border-t-4', 'border-top-width: 4px'],
        // border radius
        ['rounded', 'border-radius: var(--radius)'],
        ['rounded-none', 'border-radius: 0'],
        ['rounded-full', 'calc(infinity * 1px)'],
        ['rounded-lg', 'border-radius: var(--radius-lg)'],
        ['rounded-t', 'border-top-left-radius'],
        ['rounded-tr', 'border-top-right-radius: var(--radius)'],
        ['rounded-t-lg', 'border-top-left-radius: var(--radius-lg)'],
        ['rounded-[4px]', 'border-radius: 4px'],
        // typography
        ['text-lg', 'font-size: var(--text-lg)'],
        ['text-[20px]', 'font-size: 20px'],
        ['leading-6', 'line-height:'],
        ['leading-[1.5]', 'line-height: 1.5'],
        ['tracking-wide', 'letter-spacing:'],
        ['tracking-[0.1em]', 'letter-spacing: 0.1em'],
        ['font-sans', 'font-family:'],
        ['font-[Arial]', 'font-family: Arial'],
        // effects
        ['shadow', 'box-shadow: var(--shadow)'],
        ['shadow-[0_1px_2px]', 'box-shadow: 0 1px 2px'],
        ['outline-none', 'outline: 2px solid transparent'],
        ['outline-2', 'outline-width: 2px'],
        ['ring', '--tw-ring-shadow'],
        ['ring-2', '0 0 0 2px'],
        // flex item
        ['grow-0', 'flex-grow: 0'],
        ['shrink-0', 'flex-shrink: 0'],
        ['order-first', 'order: -9999'],
        ['order-last', 'order: 9999'],
        ['order-none', 'order: 0'],
        ['order-3', 'order: 3'],
        // grid
        ['columns-3', 'columns: 3'],
        ['grid-cols-3', 'grid-template-columns: repeat(3'],
        ['grid-cols-none', 'grid-template-columns: none'],
        ['grid-cols-subgrid', 'grid-template-columns: subgrid'],
        ['grid-cols-[1fr_2fr]', 'grid-template-columns: 1fr 2fr'],
        ['grid-rows-2', 'grid-template-rows: repeat(2'],
        ['col-span-2', 'grid-column: span 2'],
        ['col-span-full', 'grid-column: 1 / -1'],
        ['row-span-3', 'grid-row: span 3'],
        // transforms
        ['scale-x-50', '--tw-scale-x: 0.5'],
        ['scale-y-75', '--tw-scale-y: 0.75'],
        ['scale-50', 'scale:'],
        ['rotate-45', 'rotate: 45deg'],
        ['rotate-[3deg]', 'rotate: 3deg'],
        ['translate-x-4', 'translate:'],
        ['translate-y-4', 'translate:'],
        // transitions
        ['transition', 'transition-property:'],
        ['transition-all', 'transition-property: all'],
        ['transition-none', 'transition-property: none'],
        ['duration-300', 'transition-duration: 300ms'],
        ['duration-[2s]', 'transition-duration: 2s'],
        ['ease-linear', 'transition-timing-function:'],
        ['delay-150', 'transition-delay: 150ms'],
        ['delay-[1s]', 'transition-delay: 1s'],
        // colors (exercise the color-prefix loop across COLOR_PROPS)
        ['bg-red-500', 'background-color:'],
        ['text-white', 'color:'],
        ['fill-blue-500', 'fill:'],
        ['stroke-emerald-500', 'stroke:'],
        ['decoration-pink-500', 'text-decoration-color:'],
        ['border-t-red-500', 'border-top-color:'],
        // arbitrary property
        ['[mask-type:luminance]', 'mask-type: luminance'],
    ])('%s declares %s', (utility, expected) => {
        expect(generateDeclarations(utility)).toContain(expected);
    });
});

describe('parseVariants — nested variant prefixes', () => {
    it('extracts a pseudo-class variant', () => {
        const v = parseVariants('hover:bg-red-500');
        expect(v.utility).toBe('bg-red-500');
        expect(v.pseudoSuffix).toBe(':hover');
        expect(v.selectorPrefix).toBe('');
    });

    it('stacks multiple pseudo-class variants', () => {
        const v = parseVariants('focus:hover:bg-red-500');
        expect(v.utility).toBe('bg-red-500');
        expect(v.pseudoSuffix).toContain(':hover');
        expect(v.pseudoSuffix).toContain(':focus');
    });

    it('maps dark to a descendant selector prefix', () => {
        const v = parseVariants('dark:text-white');
        expect(v.selectorPrefix).toBe('.dark ');
        expect(v.utility).toBe('text-white');
    });

    it('maps light to a descendant selector prefix', () => {
        expect(parseVariants('light:text-black').selectorPrefix).toBe('.light ');
    });

    it('records a responsive breakpoint tier', () => {
        expect(parseVariants('md:p-4').tier).toBe('md');
    });

    it('records a max-width breakpoint tier', () => {
        expect(parseVariants('max-lg:p-4').tier).toBe('max-lg');
    });

    it('treats an unknown variant as base and keeps the utility', () => {
        const v = parseVariants('group-hover:opacity-50');
        expect(v.tier).toBe('base');
        expect(v.utility).toBe('opacity-50');
    });

    it('returns the bare utility when there is no variant', () => {
        const v = parseVariants('p-4');
        expect(v.utility).toBe('p-4');
        expect(v.pseudoSuffix).toBe('');
        expect(v.selectorPrefix).toBe('');
    });
});

describe('generateCSSRule — nested variants', () => {
    it('appends a pseudo-class suffix to the selector', () => {
        const rule = generateCSSRule('hover:opacity-50');
        expect(rule).toContain(':hover {');
        expect(rule).toContain('opacity: 0.5');
    });

    it('prefixes a dark-mode descendant selector', () => {
        const rule = generateCSSRule('dark:opacity-50');
        expect(rule).toMatch(/^\.dark /);
        expect(rule).toContain('opacity: 0.5');
    });
});

describe('generateCSSRule', () => {
    it('wraps declarations in a selector for a known utility', () => {
        expect(generateCSSRule('opacity-50')).toBe('.opacity-50 { opacity: 0.5 }');
    });

    it('escapes special characters in the class selector', () => {
        const rule = generateCSSRule('rounded-[4px]');
        expect(rule).toContain('border-radius: 4px');
        expect(rule).toMatch(/^\.rounded-\\?\[4px\\?\]/);
    });

    it('returns an empty string for an unknown utility', () => {
        expect(generateCSSRule('definitely-not-a-utility-xyz')).toBe('');
        expect(generateDeclarations('definitely-not-a-utility-xyz')).toBe('');
    });
});
