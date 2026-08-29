/**
 * What a whole `className` attribute becomes, end to end.
 *
 * The pieces underneath — the tokenizer, the variant splitter and the
 * variant-to-sz-key map — are unit-tested in Rust beside the code, in
 * `packages/core/src/migrate/variant_parser.rs`. What is left here is the
 * question only the whole pass can answer: how those pieces compose into one
 * nested sz object.
 */
import { describe, expect, it } from 'vitest';

import { classNameToSzObject } from '../src/migrate.js';

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

    it('group-data-[active] (brackets)', () => {
        const { szObject } = classNameToSzObject('group-data-[active]:border-blue-500');
        expect(szObject).toEqual({ group: { data: { active: { borderColor: 'blue-500' } } } });
    });

    it('group-data-active (bare shorthand)', () => {
        const { szObject } = classNameToSzObject('group-data-active:border-blue-500');
        expect(szObject).toEqual({ group: { data: { active: { borderColor: 'blue-500' } } } });
    });

    it("group-data-[active='true']/card (value match + named group)", () => {
        const { szObject } = classNameToSzObject("group-data-[active='true']/card:text-blue-600");
        expect(szObject).toEqual({
            group: { card: { data: { "active='true'": { color: 'blue-600' } } } },
        });
    });

    it('dark:group-data-[active]:border-blue-500 (compound)', () => {
        const { szObject } = classNameToSzObject('dark:group-data-[active]:border-blue-500');
        expect(szObject).toEqual({
            dark: { group: { data: { active: { borderColor: 'blue-500' } } } },
        });
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
        expect(szObject).toEqual({ supports: { 'display:grid': { display: 'grid' } } });
    });

    it('min breakpoint', () => {
        const { szObject } = classNameToSzObject('min-[320px]:text-center');
        expect(szObject).toEqual({ min: { '320px': { textAlign: 'center' } } });
    });

    it('container query', () => {
        const { szObject } = classNameToSzObject('@md:flex');
        expect(szObject).toEqual({ '@md': { display: 'flex' } });
    });

    it('container query with name', () => {
        const { szObject } = classNameToSzObject('@md/sidebar:block');
        expect(szObject).toEqual({ '@md': { sidebar: { display: 'block' } } });
    });

    it('@min arbitrary', () => {
        const { szObject } = classNameToSzObject('@min-[475px]:flex');
        expect(szObject).toEqual({ '@min': { '475px': { display: 'flex' } } });
    });

    it('gradient class', () => {
        const { szObject } = classNameToSzObject('bg-linear-to-r');
        expect(szObject).toEqual({
            bgImg: { gradient: 'linear', dir: 'to-r' },
        });
    });

    it('unrecognized classes tracked separately', () => {
        const { szObject, unrecognized } = classNameToSzObject('p-4 my-custom-class flex');
        expect(szObject).toEqual({ p: 4, display: 'flex' });
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
            md: { display: 'flex', items: 'center' },
        });
    });

    it('color with opacity', () => {
        const { szObject } = classNameToSzObject('bg-blue-500/50');
        expect(szObject).toEqual({ bg: { color: 'blue-500', op: 50 } });
    });

    it('does not share cached object-valued parsed results between calls', () => {
        const first = classNameToSzObject('bg-blue-500/50').szObject as {
            bg: { color: string; op: number };
        };
        first.bg.color = 'mutated';

        const second = classNameToSzObject('bg-blue-500/50').szObject;
        expect(second).toEqual({ bg: { color: 'blue-500', op: 50 } });
    });

    it('merges same variant nesting', () => {
        const { szObject } = classNameToSzObject('hover:bg-blue-600 hover:text-white');
        expect(szObject).toEqual({
            hover: { bg: 'blue-600', color: 'white' },
        });
    });

    it('single-property classes → canonical', () => {
        const { szObject } = classNameToSzObject('flex relative');
        expect(szObject).toEqual({ display: 'flex', position: 'relative' });
    });

    it('no brackets in variant keys', () => {
        const { szObject } = classNameToSzObject('min-[320px]:flex max-[600px]:hidden');
        // Keys should NOT have brackets
        expect(szObject).toEqual({
            min: { '320px': { display: 'flex' } },
            max: { '600px': { display: 'none' } },
        });
        // Verify no brackets
        expect('320px' in (szObject.min as Record<string, unknown>)).toBe(true);
        expect('[320px]' in (szObject.min as Record<string, unknown>)).toBe(false);
    });

    it('fails closed on conflicting display classes in the same scope', () => {
        const { szObject, unrecognized } = classNameToSzObject('block flex p-4');
        expect(szObject).toEqual({ p: 4 });
        expect(unrecognized).toEqual(['block', 'flex']);
    });

    it('keeps later display tokens unresolved after a scope conflict', () => {
        const { szObject, unrecognized } = classNameToSzObject('block flex inline p-4');
        expect(szObject).toEqual({ p: 4 });
        expect(unrecognized).toEqual(['block', 'flex', 'inline']);
    });

    it('migrates every single-property group to its canonical key', () => {
        const { szObject } = classNameToSzObject(
            'flex absolute invisible isolate uppercase italic underline antialiased',
        );
        expect(szObject).toEqual({
            display: 'flex',
            position: 'absolute',
            visibility: 'hidden',
            isolation: 'isolate',
            textTransform: 'uppercase',
            fontStyle: 'italic',
            decoration: 'underline',
            fontSmoothing: 'grayscale',
        });
    });

    it('fails closed on conflicting text-transform classes', () => {
        const { szObject, unrecognized } = classNameToSzObject('uppercase lowercase p-4');
        expect(szObject).toEqual({ p: 4 });
        expect(unrecognized).toEqual(['uppercase', 'lowercase']);
    });

    it('allows display classes in different variant scopes', () => {
        const { szObject, unrecognized } = classNameToSzObject('block md:flex');
        expect(szObject).toEqual({ display: 'block', md: { display: 'flex' } });
        expect(unrecognized).toEqual([]);
    });

    it('keeps flex display distinct from flex shorthand', () => {
        const { szObject, unrecognized } = classNameToSzObject('flex flex-1');
        expect(szObject).toEqual({ display: 'flex', flex: '1' });
        expect(unrecognized).toEqual([]);
    });

    it('fails closed on conflicting display classes inside the same variant scope', () => {
        const { szObject, unrecognized } = classNameToSzObject('md:block md:flex hover:flex');
        expect(szObject).toEqual({ hover: { display: 'flex' } });
        expect(unrecognized).toEqual(['md:block', 'md:flex']);
    });
});
