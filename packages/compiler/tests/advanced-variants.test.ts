/**
 * G1 — Advanced Variants Unit Tests
 *
 * Dedicated granular tests for every advanced variant handler in transform.ts:
 *   handleHas, handleGroupPeer, handleNot, handleData, handleAria,
 *   handleSupports, container queries (@), min/max breakpoints.
 *
 * These complement the integration-level spec-tests.json with focused
 * unit-level coverage of each code path.
 */

import { describe, expect, it } from 'vitest';

import { type SzObject, transform } from '../src/transform-core.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Shorthand: transform and return className string.
 * @param obj - The sz object to transform.
 * @returns {string} The resulting className string. */

const t = (obj: any): string => transform(obj as SzObject).className;

// ===========================================================================
// 1. has variant — handleHas()
// ===========================================================================

describe('has variant', () => {
    // --- Element selectors ---
    it('element selector: img', () => {
        expect(t({ has: { img: { border: 2 } } })).toBe('has-[img]:border-2');
    });

    it('element selector: p', () => {
        expect(t({ has: { p: { mt: 4 } } })).toBe('has-[p]:mt-4');
    });

    it('element selector: svg', () => {
        expect(t({ has: { svg: { fill: 'current' } } })).toBe('has-[svg]:fill-current');
    });

    // --- Pseudo-class selectors ---
    it('pseudo-class: checked', () => {
        expect(t({ has: { checked: { bg: 'green-500' } } })).toBe('has-[:checked]:bg-green-500');
    });

    it('pseudo-class: hover', () => {
        expect(t({ has: { hover: { opacity: 75 } } })).toBe('has-[:hover]:opacity-75');
    });

    it('pseudo-class: focus', () => {
        expect(t({ has: { focus: { ring: 2 } } })).toBe('has-[:focus]:ring-2');
    });

    // --- Multiple selectors ---
    it('multiple selectors', () => {
        const result = t({ has: { img: { border: 2 }, p: { mt: 4 } } });
        expect(result).toContain('has-[img]:border-2');
        expect(result).toContain('has-[p]:mt-4');
    });

    // --- Nested with other variants ---
    it('nested inside hover variant', () => {
        const result = t({ hover: { has: { img: { opacity: 100 } } } });
        expect(result).toBe('hover:has-[img]:opacity-100');
    });

    // --- Skips null/undefined/false ---
    it('skips null values', () => {
        expect(t({ has: { img: null } })).toBe('');
    });

    it('skips undefined values', () => {
        expect(t({ has: { img: undefined } })).toBe('');
    });

    it('skips false values', () => {
        expect(t({ has: { img: false } })).toBe('');
    });
});

// ===========================================================================
// 2. group / peer variants — handleGroupPeer()
// ===========================================================================

describe('group variant', () => {
    // --- Basic group-hover ---
    it('group-hover', () => {
        expect(t({ group: { hover: { bg: 'blue-500' } } })).toBe('group-hover:bg-blue-500');
    });

    it('group-focus', () => {
        expect(t({ group: { focus: { ring: 2 } } })).toBe('group-focus:ring-2');
    });

    it('group-active', () => {
        expect(t({ group: { active: { scale: 95 } } })).toBe('group-active:scale-95');
    });

    // --- Named group ---
    it('named group: group-hover/sidebar', () => {
        expect(t({ group: { sidebar: { hover: { bg: 'blue-500' } } } })).toBe(
            'group-hover/sidebar:bg-blue-500',
        );
    });

    it('named group: group-focus/card', () => {
        expect(t({ group: { card: { focus: { ring: 2 } } } })).toBe('group-focus/card:ring-2');
    });

    // --- Group with has ---
    it('group-has-[a]', () => {
        expect(t({ group: { has: { a: { display: 'block' } } } })).toBe('group-has-[a]:block');
    });

    it('group-has with multiple selectors', () => {
        const result = t({ group: { has: { img: { display: 'none' }, a: { display: 'block' } } } });
        expect(result).toContain('group-has-[img]:hidden');
        expect(result).toContain('group-has-[a]:block');
    });

    // --- Arbitrary selector ---
    it('arbitrary: group-[.is-published]', () => {
        expect(t({ group: { '.is-published': { display: 'block' } } })).toBe(
            'group-[.is-published]:block',
        );
    });

    it('arbitrary: group-[#main]', () => {
        expect(t({ group: { '#main': { display: 'flex' } } })).toBe('group-[#main]:flex');
    });

    it('arbitrary: group-[[data-active]]', () => {
        expect(t({ group: { '[data-active]': { bg: 'green-500' } } })).toBe(
            'group-[[data-active]]:bg-green-500',
        );
    });

    // --- group-data-* (attribute presence) ---
    // Note: sz uses { group: { data: { attr: {...} } } } for ALL group-data-* variants.
    // The compiler always emits the bracket form group-data-[attr]:, which handles both
    // simple names (active, open) and value-match (state=open, active='true').
    // TW v4 bare shorthand (group-data-active: without brackets) is accepted as input
    // by the migration CLI and normalized to the same sz object — output always uses [].

    it('group-data-[active]: presence check', () => {
        expect(t({ group: { data: { active: { bg: 'blue-500' } } } })).toBe(
            'group-data-[active]:bg-blue-500',
        );
    });

    it('group-data-[open]: common Radix/Headless UI attribute', () => {
        expect(t({ group: { data: { open: { bg: 'blue-500' } } } })).toBe(
            'group-data-[open]:bg-blue-500',
        );
    });

    it('group-data-[closed]: closed state', () => {
        expect(t({ group: { data: { closed: { display: 'none' } } } })).toBe(
            'group-data-[closed]:hidden',
        );
    });

    it('group-data-[disabled]: disabled state', () => {
        expect(t({ group: { data: { disabled: { opacity: 50 } } } })).toBe(
            'group-data-[disabled]:opacity-50',
        );
    });

    it('group-data-[highlighted]: highlighted state', () => {
        expect(t({ group: { data: { highlighted: { bg: 'blue-100' } } } })).toBe(
            'group-data-[highlighted]:bg-blue-100',
        );
    });

    // --- group-data-* (attribute value match, brackets required) ---
    it('group-data-[state=open]: value match', () => {
        expect(t({ group: { data: { 'state=open': { text: 'lg' } } } })).toBe(
            'group-data-[state=open]:text-lg',
        );
    });

    it("group-data-[active='true']: quoted value match", () => {
        expect(t({ group: { data: { "active='true'": { color: 'blue-600' } } } })).toBe(
            "group-data-[active='true']:text-blue-600",
        );
    });

    it('group-data-[orientation=horizontal]: Radix orientation', () => {
        expect(t({ group: { data: { 'orientation=horizontal': { display: 'flex' } } } })).toBe(
            'group-data-[orientation=horizontal]:flex',
        );
    });

    // --- group-data-* with named group (/name) ---
    it('group-data-[active]/card: named group', () => {
        expect(t({ group: { card: { data: { active: { color: 'blue-600' } } } } })).toBe(
            'group-data-[active]/card:text-blue-600',
        );
    });

    it("group-data-[active='true']/dialog: value match + named group", () => {
        expect(t({ group: { dialog: { data: { "active='true'": { color: 'blue-600' } } } } })).toBe(
            "group-data-[active='true']/dialog:text-blue-600",
        );
    });

    // --- group-aria-* ---
    it('group-aria-checked', () => {
        expect(t({ group: { aria: { checked: { bg: 'blue-500' } } } })).toBe(
            'group-aria-checked:bg-blue-500',
        );
    });

    it('group-aria-expanded', () => {
        expect(t({ group: { aria: { expanded: { display: 'block' } } } })).toBe(
            'group-aria-expanded:block',
        );
    });

    it('group-aria-[current=page]: arbitrary aria value', () => {
        expect(t({ group: { aria: { 'current=page': { color: 'blue-600' } } } })).toBe(
            'group-aria-[current=page]:text-blue-600',
        );
    });

    // --- peer-data-* (same pattern as group-data but for peer) ---
    it('peer-data-[active]: presence check', () => {
        expect(t({ peer: { data: { active: { color: 'blue-500' } } } })).toBe(
            'peer-data-[active]:text-blue-500',
        );
    });

    it('peer-data-[state=open]: value match', () => {
        expect(t({ peer: { data: { 'state=open': { display: 'block' } } } })).toBe(
            'peer-data-[state=open]:block',
        );
    });

    // --- Skips ---
    it('skips null nested values', () => {
        expect(t({ group: { hover: null } })).toBe('');
    });

    it('skips false nested values', () => {
        expect(t({ group: { hover: false } })).toBe('');
    });
});

describe('peer variant', () => {
    it('peer-focus', () => {
        expect(t({ peer: { focus: { ring: 2 } } })).toBe('peer-focus:ring-2');
    });

    it('peer-hover', () => {
        expect(t({ peer: { hover: { text: 'blue-600' } } })).toBe('peer-hover:text-blue-600');
    });

    it('peer-checked', () => {
        expect(t({ peer: { checked: { bg: 'blue-500' } } })).toBe('peer-checked:bg-blue-500');
    });

    it('named peer: peer-focus/email', () => {
        expect(t({ peer: { email: { focus: { ring: 2 } } } })).toBe('peer-focus/email:ring-2');
    });

    it('arbitrary: peer-[[data-active]]', () => {
        expect(t({ peer: { '[data-active]': { bg: 'green-500' } } })).toBe(
            'peer-[[data-active]]:bg-green-500',
        );
    });

    it('peer-has-[a]', () => {
        expect(t({ peer: { has: { a: { decoration: 'underline' } } } })).toBe(
            'peer-has-[a]:underline',
        );
    });
});

// ===========================================================================
// 3. not variant — handleNot()
// ===========================================================================

describe('not variant', () => {
    it('not-hover', () => {
        expect(t({ not: { hover: { opacity: 75 } } })).toBe('not-hover:opacity-75');
    });

    it('not-first', () => {
        expect(t({ not: { first: { mt: 4 } } })).toBe('not-first:mt-4');
    });

    it('not-last', () => {
        expect(t({ not: { last: { mb: 4 } } })).toBe('not-last:mb-4');
    });

    it('not-focus', () => {
        expect(t({ not: { focus: { ring: 0 } } })).toBe('not-focus:ring-0');
    });

    it('not-disabled', () => {
        expect(t({ not: { disabled: { cursor: 'pointer' } } })).toBe('not-disabled:cursor-pointer');
    });

    // --- Nested supports ---
    it('not-supports-[display:grid]', () => {
        expect(t({ not: { supports: { 'display:grid': { display: 'block' } } } })).toBe(
            'not-supports-[display:grid]:block',
        );
    });

    // --- Skips ---
    it('skips null', () => {
        expect(t({ not: { hover: null } })).toBe('');
    });

    it('skips false', () => {
        expect(t({ not: { hover: false } })).toBe('');
    });
});

// ===========================================================================
// 4. data variant — handleData()
// ===========================================================================

describe('data variant', () => {
    it('data-[active]', () => {
        expect(t({ data: { active: { bg: 'blue-500' } } })).toBe('data-[active]:bg-blue-500');
    });

    it('data-[size=large]', () => {
        expect(t({ data: { 'size=large': { text: 'lg' } } })).toBe('data-[size=large]:text-lg');
    });

    it('data-[loading]', () => {
        expect(t({ data: { loading: { opacity: 50 } } })).toBe('data-[loading]:opacity-50');
    });

    it('data-[theme=dark]', () => {
        expect(t({ data: { 'theme=dark': { bg: 'gray-900' } } })).toBe(
            'data-[theme=dark]:bg-gray-900',
        );
    });

    it('multiple data attributes', () => {
        const result = t({ data: { active: { bg: 'blue-500' }, loading: { opacity: 50 } } });
        expect(result).toContain('data-[active]:bg-blue-500');
        expect(result).toContain('data-[loading]:opacity-50');
    });

    it('skips null', () => {
        expect(t({ data: { active: null } })).toBe('');
    });

    it('skips false', () => {
        expect(t({ data: { active: false } })).toBe('');
    });
});

// ===========================================================================
// 5. aria variant — handleAria()
// ===========================================================================

describe('aria variant', () => {
    // --- Standard states (aria-{state} syntax) ---
    it('aria-selected', () => {
        expect(t({ aria: { selected: { bg: 'blue-100' } } })).toBe('aria-selected:bg-blue-100');
    });

    it('aria-expanded', () => {
        expect(t({ aria: { expanded: { rotate: 180 } } })).toBe('aria-expanded:rotate-180');
    });

    it('aria-disabled', () => {
        expect(t({ aria: { disabled: { opacity: 50 } } })).toBe('aria-disabled:opacity-50');
    });

    it('aria-checked', () => {
        expect(t({ aria: { checked: { bg: 'blue-500' } } })).toBe('aria-checked:bg-blue-500');
    });

    it('aria-pressed', () => {
        expect(t({ aria: { pressed: { bg: 'gray-700' } } })).toBe('aria-pressed:bg-gray-700');
    });

    it('aria-hidden', () => {
        expect(t({ aria: { hidden: { sr: true } } })).toContain('aria-hidden:');
    });

    it('aria-required', () => {
        expect(t({ aria: { required: { borderColor: 'red-500' } } })).toBe(
            'aria-required:border-red-500',
        );
    });

    // --- Arbitrary aria (aria-[*] syntax) ---
    it('arbitrary: aria-[current=page]', () => {
        expect(t({ aria: { 'current=page': { weight: 'bold' } } })).toBe(
            'aria-[current=page]:font-bold',
        );
    });

    it('arbitrary: aria-[sort=ascending]', () => {
        expect(t({ aria: { 'sort=ascending': { bg: 'blue-50' } } })).toBe(
            'aria-[sort=ascending]:bg-blue-50',
        );
    });

    // --- Skips ---
    it('skips null', () => {
        expect(t({ aria: { selected: null } })).toBe('');
    });

    it('skips false', () => {
        expect(t({ aria: { expanded: false } })).toBe('');
    });
});

// ===========================================================================
// 6. supports variant — handleSupports()
// ===========================================================================

describe('supports variant', () => {
    it('supports-[display:grid]', () => {
        expect(t({ supports: { 'display:grid': { display: 'grid' } } })).toBe(
            'supports-[display:grid]:grid',
        );
    });

    it('supports-[backdrop-filter:blur(0)]', () => {
        const result = t({ supports: { 'backdrop-filter:blur(0)': { backdropBlur: 'sm' } } });
        expect(result).toContain('supports-[backdrop-filter:blur(0)]:');
    });

    it('supports-[gap:1rem]', () => {
        expect(t({ supports: { 'gap:1rem': { gap: 4 } } })).toBe('supports-[gap:1rem]:gap-4');
    });

    it('skips null', () => {
        expect(t({ supports: { 'display:grid': null } })).toBe('');
    });

    it('skips false', () => {
        expect(t({ supports: { 'display:grid': false } })).toBe('');
    });
});

// ===========================================================================
// 7. Container queries — @ prefix
// ===========================================================================

describe('container queries', () => {
    // --- Container type via transform ---
    it('container: true → "container"', () => {
        expect(t({ container: true })).toBe('container');
    });

    it('container: "sidebar" → @container/sidebar', () => {
        expect(t({ container: 'sidebar' })).toBe('@container/sidebar');
    });

    // --- Container query breakpoints ---
    it('@md:flex', () => {
        expect(t({ '@md': { display: 'flex' } })).toBe('@md:flex');
    });

    it('@lg:grid-cols-3', () => {
        expect(t({ '@lg': { gridCols: 3 } })).toBe('@lg:grid-cols-3');
    });

    it('@sm:hidden', () => {
        expect(t({ '@sm': { display: 'none' } })).toBe('@sm:hidden');
    });

    // --- Named container query ---
    it('@md/sidebar:flex', () => {
        expect(t({ '@md': { sidebar: { display: 'flex' } } })).toBe('@md/sidebar:flex');
    });

    // --- Arbitrary container breakpoint ---
    it('@min-[475px]:flex', () => {
        expect(t({ '@min': { '[475px]': { display: 'flex' } } })).toBe('@min-[475px]:flex');
    });

    it('@max-[640px]:hidden', () => {
        expect(t({ '@max': { '[640px]': { display: 'none' } } })).toBe('@max-[640px]:hidden');
    });

    // Bracket-free keys: compiler auto-wraps in []
    it('@min bracket-free: @min-[475px]:flex', () => {
        expect(t({ '@min': { '475px': { display: 'flex' } } })).toBe('@min-[475px]:flex');
    });

    it('@max bracket-free: @max-[640px]:hidden', () => {
        expect(t({ '@max': { '640px': { display: 'none' } } })).toBe('@max-[640px]:hidden');
    });

    // --- Multiple container properties ---
    it('multiple @md properties', () => {
        const result = t({ '@md': { display: 'flex', gap: 4 } });
        expect(result).toContain('@md:flex');
        expect(result).toContain('@md:gap-4');
    });
});

// ===========================================================================
// 8. min/max breakpoints
// ===========================================================================

describe('min/max breakpoints', () => {
    it('min-md:flex', () => {
        expect(t({ min: { md: { display: 'flex' } } })).toBe('min-md:flex');
    });

    it('max-lg:hidden', () => {
        expect(t({ max: { lg: { display: 'none' } } })).toBe('max-lg:hidden');
    });

    it('min-[320px]:p-2', () => {
        expect(t({ min: { '[320px]': { p: 2 } } })).toBe('min-[320px]:p-2');
    });

    it('max-[1024px]:grid-cols-1', () => {
        expect(t({ max: { '[1024px]': { gridCols: 1 } } })).toBe('max-[1024px]:grid-cols-1');
    });

    it('min-sm:text-sm', () => {
        expect(t({ min: { sm: { text: 'sm' } } })).toBe('min-sm:text-sm');
    });

    // Bracket-free keys: compiler auto-wraps in []
    it('min bracket-free: min-[320px]:p-2', () => {
        expect(t({ min: { '320px': { p: 2 } } })).toBe('min-[320px]:p-2');
    });

    it('max bracket-free: max-[1024px]:grid-cols-1', () => {
        expect(t({ max: { '1024px': { gridCols: 1 } } })).toBe('max-[1024px]:grid-cols-1');
    });

    it('skips null breakpoint value', () => {
        expect(t({ min: { md: null } })).toBe('');
    });

    it('skips false breakpoint value', () => {
        expect(t({ max: { lg: false } })).toBe('');
    });
});

// ===========================================================================
// 9. Variant chaining (deep nesting)
// ===========================================================================

describe('variant chaining', () => {
    it('dark:hover:bg-blue-500', () => {
        expect(t({ dark: { hover: { bg: 'blue-500' } } })).toBe('dark:hover:bg-blue-500');
    });

    it('md:hover:text-white', () => {
        expect(t({ md: { hover: { text: 'white' } } })).toBe('md:hover:text-white');
    });

    it('lg:focus:ring-2', () => {
        expect(t({ lg: { focus: { ring: 2 } } })).toBe('lg:focus:ring-2');
    });

    it('first:hover:bg-blue-50', () => {
        expect(t({ first: { hover: { bg: 'blue-50' } } })).toBe('first:hover:bg-blue-50');
    });

    it('group-hover:dark:text-white', () => {
        const result = t({ group: { hover: { dark: { text: 'white' } } } });
        expect(result).toBe('group-hover:dark:text-white');
    });
});

// ===========================================================================
// Responsive breakpoints — combined with state/group/peer/dark, custom and
// arbitrary breakpoints, nested value sub-properties, modifiers.
// Variant order is preserved as authored; Tailwind v4 generates an equivalent
// (logically AND-ed) rule for either order, so both are valid.
// ===========================================================================

describe('responsive breakpoints', () => {
    it('breakpoint × state, both nesting orders', () => {
        expect(t({ md: { hover: { bg: 'blue-500' } } })).toBe('md:hover:bg-blue-500');
        expect(t({ hover: { md: { bg: 'blue-500' } } })).toBe('hover:md:bg-blue-500');
        expect(t({ md: { dark: { bg: 'blue-500' } } })).toBe('md:dark:bg-blue-500');
        expect(t({ dark: { md: { bg: 'blue-500' } } })).toBe('dark:md:bg-blue-500');
        expect(t({ md: { focus: { p: 2 } } })).toBe('md:focus:p-2');
    });

    it('breakpoint × group / peer', () => {
        expect(t({ md: { group: { hover: { p: 2 } } } })).toBe('md:group-hover:p-2');
        expect(t({ group: { hover: { md: { p: 2 } } } })).toBe('group-hover:md:p-2');
        expect(t({ md: { peer: { checked: { p: 2 } } } })).toBe('md:peer-checked:p-2');
    });

    it('breakpoint × nested value sub-property (color + opacity)', () => {
        expect(t({ md: { bg: { color: 'black', op: 30 } } })).toBe('md:bg-black/30');
        expect(t({ md: { hover: { bg: { color: 'black', op: 30 } } } })).toBe(
            'md:hover:bg-black/30',
        );
    });

    it('custom, arbitrary, max and container breakpoints pass through', () => {
        expect(t({ tablet: { p: 3 } })).toBe('tablet:p-3');
        expect(t({ tablet: { hover: { p: 3 } } })).toBe('tablet:hover:p-3');
        expect(t({ 'min-[320px]': { display: 'flex' } })).toBe('min-[320px]:flex');
        expect(t({ 'max-[600px]': { display: 'none' } })).toBe('max-[600px]:hidden');
        expect(t({ 'max-md': { p: 2 } })).toBe('max-md:p-2');
        expect(t({ '@md': { p: 2 } })).toBe('@md:p-2');
        expect(t({ '@container/sidebar': { p: 2 } })).toBe('@container/sidebar:p-2');
    });

    it('multiple breakpoints on one element, in source order', () => {
        expect(t({ sm: { p: 1 }, md: { p: 2 }, lg: { p: 3 }, xl: { p: 4 }, '2xl': { p: 5 } })).toBe(
            'sm:p-1 md:p-2 lg:p-3 xl:p-4 2xl:p-5',
        );
    });

    it('breakpoint × modifiers (important, negative, arbitrary value)', () => {
        expect(t({ md: { bg: 'red-500!' } })).toBe('md:bg-red-500!');
        expect(t({ md: { mt: -4 } })).toBe('md:-mt-4');
        expect(t({ md: { w: '[320px]' } })).toBe('md:w-[320px]');
    });

    it('empty breakpoint object emits nothing without throwing', () => {
        expect(t({ md: {} })).toBe('');
    });
});
