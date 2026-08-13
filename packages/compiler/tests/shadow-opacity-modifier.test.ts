/**
 * Shadow-family opacity modifiers — the Tailwind 4.3.3 contract.
 *
 * Tailwind 4.3.3 fixed fractional opacity modifiers on named shadow sizes
 * (`shadow-sm/12.5`, `text-shadow-sm/12.5`, `drop-shadow-sm/12.5`,
 * `inset-shadow-sm/12.5`). sz reaches those utilities through the string
 * pass-through (`{ shadow: 'sm/12.5' }`), so this suite pins the emitted
 * class for every shadow family × opacity spelling, plus the `{ color, op }`
 * object form.
 *
 * Var-color rule: after a shadow-family prefix, a bare `(--c)` suffix is the
 * shadow VALUE (`--tw-shadow: var(--c)`), so var colors must carry the
 * `color:` hint (`shadow-(color:--c)`) to land on `--tw-shadow-color`.
 * The end-to-end CSS assertions live in
 * `packages/unplugin/tests/tailwind-4-3-compat.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { type SzObject, transform } from '../src/transform-core.js';

const t = (sz: object): string => transform(sz as SzObject).className;

describe('named shadow sizes with opacity modifiers (TW 4.3.3)', () => {
    it.each([
        ['shadow', 'sm/12.5', 'shadow-sm/12.5'],
        ['shadow', '2xl/50', 'shadow-2xl/50'],
        ['textShadow', 'sm/12.5', 'text-shadow-sm/12.5'],
        ['dropShadow', 'sm/12.5', 'drop-shadow-sm/12.5'],
        ['insetShadow', 'sm/12.5', 'inset-shadow-sm/12.5'],
        ['dropShadow', 'xl/62.5', 'drop-shadow-xl/62.5'],
        ['textShadow', 'lg/25', 'text-shadow-lg/25'],
    ])('{ %s: %j } → %s', (key, value, expected) => {
        expect(t({ [key]: value })).toBe(expected);
    });

    it('passes an arbitrary bracket modifier through unchanged', () => {
        expect(t({ shadow: 'sm/[12.499]' })).toBe('shadow-sm/[12.499]');
    });

    it('keeps the modifier under variants', () => {
        expect(t({ hover: { shadow: 'sm/12.5' } })).toBe('hover:shadow-sm/12.5');
        expect(t({ md: { dropShadow: 'xl/62.5' } })).toBe('md:drop-shadow-xl/62.5');
    });

    it('applies the modifier to a shadow value var', () => {
        // `(--s)` targets the shadow value itself; the modifier still works.
        expect(t({ shadow: '(--s)/50' })).toBe('shadow-(--s)/50');
    });
});

describe('shadow color object form { color, op } with fractional opacity', () => {
    it.each([
        ['shadowColor', 'blue-500', 12.5, 'shadow-blue-500/12.5'],
        ['insetShadowColor', 'black', 37.5, 'inset-shadow-black/37.5'],
        ['textShadowColor', 'cyan-400', 12.5, 'text-shadow-cyan-400/12.5'],
        ['dropShadowColor', 'red-500', 62.5, 'drop-shadow-red-500/62.5'],
    ])('{ %s: { color: %j, op: %d } } → %s', (key, color, op, expected) => {
        expect(t({ [key]: { color, op } })).toBe(expected);
    });

    it('brackets non-half-step decimal opacity', () => {
        expect(t({ shadowColor: { color: 'blue-500', op: 12.499 } })).toBe(
            'shadow-blue-500/[12.499]',
        );
    });

    it('brackets percentage string opacity and parenthesizes var opacity', () => {
        expect(t({ shadowColor: { color: 'blue-500', op: '12.5%' } })).toBe(
            'shadow-blue-500/[12.5%]',
        );
        expect(t({ shadowColor: { color: 'blue-500', op: '--o' } })).toBe('shadow-blue-500/(--o)');
    });
});

describe('shadow-family var colors carry the color: hint', () => {
    it.each([
        ['shadowColor', 'shadow-(color:--c)/50', 50],
        ['insetShadowColor', 'inset-shadow-(color:--c)/30', 30],
        ['textShadowColor', 'text-shadow-(color:--c)/25', 25],
        ['dropShadowColor', 'drop-shadow-(color:--c)/40', 40],
    ])('{ %s: { color: "--c", op } } → %s', (key, expected, op) => {
        expect(t({ [key]: { color: '--c', op } })).toBe(expected);
    });

    it('hints the string form of every shadow color key', () => {
        expect(t({ shadowColor: '--c' })).toBe('shadow-(color:--c)');
        expect(t({ insetShadowColor: '--c' })).toBe('inset-shadow-(color:--c)');
        expect(t({ textShadowColor: '--c' })).toBe('text-shadow-(color:--c)');
        expect(t({ dropShadowColor: '--c' })).toBe('drop-shadow-(color:--c)');
    });

    it('hints the base shadow key when the object form names a var color', () => {
        expect(t({ shadow: { color: '--c', op: 12.5 } })).toBe('shadow-(color:--c)/12.5');
    });

    it('keeps the bare paren form for non-shadow color props', () => {
        // bg-(--c) already means background-color — no hint needed.
        expect(t({ bg: { color: '--my-color', op: 50 } })).toBe('bg-(--my-color)/50');
    });

    it('keeps the arbitrary bracket form for var colors with fallbacks', () => {
        expect(t({ shadowColor: { color: '--c(fallback)', op: 50 } })).toBe(
            'shadow-[--c(fallback)]/50',
        );
    });
});
