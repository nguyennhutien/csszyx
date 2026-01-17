import { describe, expect, it } from 'vitest';

import {
    classNameToSzObject,
    extractVariants,
    mapVariant,
    tokenize,
} from '../src/migrate/variant-parser.js';

describe('variant-parser', () => {
    // ========================================================================
    // TOKENIZE
    // ========================================================================
    describe('tokenize', () => {
        it('splits by whitespace', () => {
            expect(tokenize('p-4 bg-blue-500 flex')).toEqual(['p-4', 'bg-blue-500', 'flex']);
        });

        it('handles multiple spaces', () => {
            expect(tokenize('  p-4   bg-blue-500  ')).toEqual(['p-4', 'bg-blue-500']);
        });

        it('handles single class', () => {
            expect(tokenize('p-4')).toEqual(['p-4']);
        });

        it('handles empty string', () => {
            expect(tokenize('')).toEqual([]);
            expect(tokenize('   ')).toEqual([]);
        });
    });

    // ========================================================================
    // EXTRACT VARIANTS
    // ========================================================================
    describe('extractVariants', () => {
        it('no variants', () => {
            expect(extractVariants('p-4')).toEqual({ variantParts: [], baseClass: 'p-4' });
        });

        it('single variant', () => {
            expect(extractVariants('hover:bg-blue-500')).toEqual({
                variantParts: ['hover'],
                baseClass: 'bg-blue-500',
            });
        });

        it('multiple variants', () => {
            expect(extractVariants('md:hover:bg-blue-500')).toEqual({
                variantParts: ['md', 'hover'],
                baseClass: 'bg-blue-500',
            });
        });

        it('preserves brackets around colons', () => {
            expect(extractVariants('supports-[display:grid]:grid')).toEqual({
                variantParts: ['supports-[display:grid]'],
                baseClass: 'grid',
            });
        });

        it('arbitrary variant with colons', () => {
            expect(extractVariants('aria-[current=page]:font-bold')).toEqual({
                variantParts: ['aria-[current=page]'],
                baseClass: 'font-bold',
            });
        });

        it('group-hover/name', () => {
            expect(extractVariants('group-hover/sidebar:text-white')).toEqual({
                variantParts: ['group-hover/sidebar'],
                baseClass: 'text-white',
            });
        });

        it('data attribute', () => {
            expect(extractVariants('data-[active]:bg-blue-500')).toEqual({
                variantParts: ['data-[active]'],
                baseClass: 'bg-blue-500',
            });
        });

        it('min breakpoint', () => {
            expect(extractVariants('min-[320px]:text-center')).toEqual({
                variantParts: ['min-[320px]'],
                baseClass: 'text-center',
            });
        });

        it('container query', () => {
            expect(extractVariants('@md:flex')).toEqual({
                variantParts: ['@md'],
                baseClass: 'flex',
            });
        });

        it('container query with name', () => {
            expect(extractVariants('@md/sidebar:block')).toEqual({
                variantParts: ['@md/sidebar'],
                baseClass: 'block',
            });
        });

        it('@min with arbitrary value', () => {
            expect(extractVariants('@min-[475px]:flex')).toEqual({
                variantParts: ['@min-[475px]'],
                baseClass: 'flex',
            });
        });
    });

    // ========================================================================
    // MAP VARIANT
    // ========================================================================
    describe('mapVariant', () => {
        it('simple variants', () => {
            expect(mapVariant('hover')).toEqual(['hover']);
            expect(mapVariant('focus')).toEqual(['focus']);
            expect(mapVariant('active')).toEqual(['active']);
            expect(mapVariant('disabled')).toEqual(['disabled']);
            expect(mapVariant('first')).toEqual(['first']);
            expect(mapVariant('last')).toEqual(['last']);
            expect(mapVariant('odd')).toEqual(['odd']);
            expect(mapVariant('even')).toEqual(['even']);
        });

        it('responsive variants', () => {
            expect(mapVariant('sm')).toEqual(['sm']);
            expect(mapVariant('md')).toEqual(['md']);
            expect(mapVariant('lg')).toEqual(['lg']);
            expect(mapVariant('xl')).toEqual(['xl']);
            expect(mapVariant('2xl')).toEqual(['2xl']);
        });

        it('multi-word variants → camelCase', () => {
            expect(mapVariant('focus-within')).toEqual(['focusWithin']);
            expect(mapVariant('focus-visible')).toEqual(['focusVisible']);
            expect(mapVariant('first-of-type')).toEqual(['firstOfType']);
            expect(mapVariant('last-of-type')).toEqual(['lastOfType']);
            expect(mapVariant('motion-reduce')).toEqual(['motionReduce']);
            expect(mapVariant('motion-safe')).toEqual(['motionSafe']);
            expect(mapVariant('placeholder-shown')).toEqual(['placeholderShown']);
            expect(mapVariant('read-only')).toEqual(['readOnly']);
        });

        it('pseudo elements', () => {
            expect(mapVariant('before')).toEqual(['before']);
            expect(mapVariant('after')).toEqual(['after']);
            expect(mapVariant('placeholder')).toEqual(['placeholder']);
        });

        it('dark/light', () => {
            expect(mapVariant('dark')).toEqual(['dark']);
            expect(mapVariant('light')).toEqual(['light']);
        });

        // GROUP/PEER
        it('group-hover', () => {
            expect(mapVariant('group-hover')).toEqual(['group', 'hover']);
        });

        it('group-hover/sidebar', () => {
            expect(mapVariant('group-hover/sidebar')).toEqual(['group', 'sidebar', 'hover']);
        });

        it('peer-checked', () => {
            expect(mapVariant('peer-checked')).toEqual(['peer', 'checked']);
        });

        it('peer-checked/draft', () => {
            expect(mapVariant('peer-checked/draft')).toEqual(['peer', 'draft', 'checked']);
        });

        it('group-[.is-published]', () => {
            expect(mapVariant('group-[.is-published]')).toEqual(['group', '.is-published']);
        });

        it('group-has-[a]', () => {
            expect(mapVariant('group-has-[a]')).toEqual(['group', 'has', 'a']);
        });

        it('group-focus-within', () => {
            expect(mapVariant('group-focus-within')).toEqual(['group', 'focusWithin']);
        });

        it('peer-focus-visible/label', () => {
            expect(mapVariant('peer-focus-visible/label')).toEqual(['peer', 'label', 'focusVisible']);
        });

        // HAS
        it('has-[img]', () => {
            expect(mapVariant('has-[img]')).toEqual(['has', 'img']);
        });

        it('has-[:checked]', () => {
            expect(mapVariant('has-[:checked]')).toEqual(['has', 'checked']);
        });

        // NOT
        it('not-hover', () => {
            expect(mapVariant('not-hover')).toEqual(['not', 'hover']);
        });

        it('not-first', () => {
            expect(mapVariant('not-first')).toEqual(['not', 'first']);
        });

        it('not-supports-[display:grid]', () => {
            expect(mapVariant('not-supports-[display:grid]')).toEqual(['not', 'supports', 'display:grid']);
        });

        // DATA
        it('data-[active]', () => {
            expect(mapVariant('data-[active]')).toEqual(['data', 'active']);
        });

        it('data-[state=open]', () => {
            expect(mapVariant('data-[state=open]')).toEqual(['data', 'state=open']);
        });

        // ARIA
        it('aria-checked', () => {
            expect(mapVariant('aria-checked')).toEqual(['aria', 'checked']);
        });

        it('aria-[current=page]', () => {
            expect(mapVariant('aria-[current=page]')).toEqual(['aria', 'current=page']);
        });

        // SUPPORTS
        it('supports-[display:grid]', () => {
            expect(mapVariant('supports-[display:grid]')).toEqual(['supports', 'display:grid']);
        });

        // MIN/MAX
        it('min-[320px]', () => {
            expect(mapVariant('min-[320px]')).toEqual(['min', '320px']);
        });

        it('max-[600px]', () => {
            expect(mapVariant('max-[600px]')).toEqual(['max', '600px']);
        });

        it('min-md', () => {
            expect(mapVariant('min-md')).toEqual(['min', 'md']);
        });

        // CONTAINER QUERIES
        it('@md', () => {
            expect(mapVariant('@md')).toEqual(['@md']);
        });

        it('@md/sidebar', () => {
            expect(mapVariant('@md/sidebar')).toEqual(['@md', 'sidebar']);
        });

        it('@min-[475px]', () => {
            expect(mapVariant('@min-[475px]')).toEqual(['@min', '475px']);
        });

        it('@container', () => {
            expect(mapVariant('@container')).toEqual(['@container']);
        });

        // ARBITRARY VARIANT
        it('[&>span]', () => {
            expect(mapVariant('[&>span]')).toEqual(['[&>span]']);
        });
    });

    // ========================================================================
    // classNameToSzObject — INTEGRATION
    // ========================================================================
    describe('classNameToSzObject', () => {
        it('simple classes', () => {
            const { szObject } = classNameToSzObject('p-4 bg-blue-500');
            expect(szObject).toEqual({ p: 4, bg: 'blue-500' });
        });

        it('with variant', () => {
            const { szObject } = classNameToSzObject('hover:bg-blue-600');
            expect(szObject).toEqual({ hover: { bg: 'blue-600' } });
        });

        it('multiple variants', () => {
            const { szObject } = classNameToSzObject('md:hover:bg-blue-600');
            expect(szObject).toEqual({ md: { hover: { bg: 'blue-600' } } });
        });

        it('mixed base + variant', () => {
            const { szObject } = classNameToSzObject('p-4 bg-blue-500 hover:bg-blue-600');
            expect(szObject).toEqual({
                p: 4,
                bg: 'blue-500',
                hover: { bg: 'blue-600' },
            });
        });

        it('group-hover', () => {
            const { szObject } = classNameToSzObject('group-hover:text-white');
            expect(szObject).toEqual({ group: { hover: { color: 'white' } } });
        });

        it('group-hover/sidebar', () => {
            const { szObject } = classNameToSzObject('group-hover/sidebar:text-white');
            expect(szObject).toEqual({ group: { sidebar: { hover: { color: 'white' } } } });
        });

        it('has variant', () => {
            const { szObject } = classNameToSzObject('has-[img]:bg-blue-500');
            expect(szObject).toEqual({ has: { img: { bg: 'blue-500' } } });
        });

        it('data attribute', () => {
            const { szObject } = classNameToSzObject('data-[active]:bg-blue-500');
            expect(szObject).toEqual({ data: { active: { bg: 'blue-500' } } });
        });

        it('aria state', () => {
            const { szObject } = classNameToSzObject('aria-checked:bg-blue-500');
            expect(szObject).toEqual({ aria: { checked: { bg: 'blue-500' } } });
        });

        it('not variant', () => {
            const { szObject } = classNameToSzObject('not-hover:opacity-75');
            expect(szObject).toEqual({ not: { hover: { opacity: 75 } } });
        });

        it('supports variant', () => {
            const { szObject } = classNameToSzObject('supports-[display:grid]:grid');
            expect(szObject).toEqual({ supports: { 'display:grid': { grid: true } } });
        });

        it('min breakpoint', () => {
            const { szObject } = classNameToSzObject('min-[320px]:text-center');
            expect(szObject).toEqual({ min: { '320px': { textAlign: 'center' } } });
        });

        it('container query', () => {
            const { szObject } = classNameToSzObject('@md:flex');
            expect(szObject).toEqual({ '@md': { flex: true } });
        });

        it('container query with name', () => {
            const { szObject } = classNameToSzObject('@md/sidebar:block');
            expect(szObject).toEqual({ '@md': { sidebar: { block: true } } });
        });

        it('@min arbitrary', () => {
            const { szObject } = classNameToSzObject('@min-[475px]:flex');
            expect(szObject).toEqual({ '@min': { '475px': { flex: true } } });
        });

        it('gradient class', () => {
            const { szObject } = classNameToSzObject('bg-linear-to-r');
            expect(szObject).toEqual({
                bgImg: { gradient: 'linear', dir: 'to-r' },
            });
        });

        it('unrecognized classes tracked separately', () => {
            const { szObject, unrecognized } = classNameToSzObject('p-4 my-custom-class flex');
            expect(szObject).toEqual({ p: 4, flex: true });
            expect(unrecognized).toEqual(['my-custom-class']);
        });

        it('complex real-world example', () => {
            const { szObject } = classNameToSzObject(
                'p-4 bg-blue-500 hover:bg-blue-600 md:flex md:items-center',
            );
            expect(szObject).toEqual({
                p: 4,
                bg: 'blue-500',
                hover: { bg: 'blue-600' },
                md: { flex: true, items: 'center' },
            });
        });

        it('color with opacity', () => {
            const { szObject } = classNameToSzObject('bg-blue-500/50');
            expect(szObject).toEqual({ bg: { color: 'blue-500', op: 50 } });
        });

        it('merges same variant nesting', () => {
            const { szObject } = classNameToSzObject('hover:bg-blue-600 hover:text-white');
            expect(szObject).toEqual({
                hover: { bg: 'blue-600', color: 'white' },
            });
        });

        it('boolean classes', () => {
            const { szObject } = classNameToSzObject('flex relative hidden');
            expect(szObject).toEqual({ flex: true, relative: true, hidden: true });
        });

        it('no brackets in variant keys', () => {
            const { szObject } = classNameToSzObject('min-[320px]:flex max-[600px]:hidden');
            // Keys should NOT have brackets
            expect(szObject).toEqual({
                min: { '320px': { flex: true } },
                max: { '600px': { hidden: true } },
            });
            // Verify no brackets
            expect('320px' in (szObject.min as Record<string, unknown>)).toBe(true);
            expect('[320px]' in (szObject.min as Record<string, unknown>)).toBe(false);
        });
    });
});
