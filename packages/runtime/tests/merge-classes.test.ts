import { afterEach, describe, expect, it } from 'vitest';
import { mergeClasses } from '../src/merge-classes.js';

// mergeClasses is the single resolution point for a layered design-system
// component (Box < Flex < Row/Col): combine default classes with the forwarded
// override, last-wins per utility, while staying mangle-aware (unlike npm
// tailwind-merge). These lock the override contract + the fail-safe
// (never drop a class we can't confidently group).

describe('mergeClasses — single-property override (last wins)', () => {
    it('overrides the same utility, keeps unrelated classes', () => {
        expect(mergeClasses('gap-2 p-4', 'gap-8')).toBe('p-4 gap-8');
    });

    it('concatenates when there is no collision', () => {
        expect(mergeClasses('m-4', 'p-2')).toBe('m-4 p-2');
    });

    it('overrides spacing/sizing/rounded by prefix', () => {
        expect(mergeClasses('p-2', 'p-8')).toBe('p-8');
        expect(mergeClasses('w-1/2', 'w-full')).toBe('w-full');
        expect(mergeClasses('rounded-md', 'rounded-xl')).toBe('rounded-xl');
    });

    it('keeps the last occurrence position for an overridden utility', () => {
        // gap-2 then m-4 then gap-8 → gap survivor takes gap-8's later slot
        expect(mergeClasses('gap-2 m-4 gap-8')).toBe('m-4 gap-8');
    });
});

describe('mergeClasses — variant isolation', () => {
    it('does not let a base utility override its responsive variant', () => {
        expect(mergeClasses('gap-2', 'md:gap-8')).toBe('gap-2 md:gap-8');
    });

    it('overrides within the same responsive variant', () => {
        expect(mergeClasses('md:gap-2', 'md:gap-8')).toBe('md:gap-8');
    });

    it('isolates state variants from the base and each other', () => {
        expect(mergeClasses('gap-2', 'hover:gap-8')).toBe('gap-2 hover:gap-8');
        expect(mergeClasses('hover:p-2', 'hover:p-8')).toBe('hover:p-8');
    });

    it('keeps responsive + state combos distinct', () => {
        expect(mergeClasses('md:hover:p-2 p-1', 'p-8')).toBe('md:hover:p-2 p-8');
    });
});

describe('mergeClasses — fail-safe: never drop an ambiguous/unknown class', () => {
    it('under-merges flex-* (flex shorthand vs flex-direction are different properties)', () => {
        expect(mergeClasses('flex-1', 'flex-row')).toBe('flex-1 flex-row');
    });

    it('under-merges text-* (font-size vs text-color)', () => {
        expect(mergeClasses('text-sm', 'text-red-500')).toBe('text-sm text-red-500');
    });

    it('under-merges bg-* (color vs position vs size)', () => {
        expect(mergeClasses('bg-red-500', 'bg-cover')).toBe('bg-red-500 bg-cover');
    });

    it('never drops an unrecognized custom class', () => {
        expect(mergeClasses('my-custom-thing', 'p-4')).toBe('my-custom-thing p-4');
        expect(mergeClasses('a b', 'c')).toBe('a b c');
    });

    it('under-merges exact value-keyed display tokens (flex vs block)', () => {
        // both set `display`, but the box-role map keys them only by category,
        // so they are under-merged rather than risk dropping a sibling.
        expect(mergeClasses('flex', 'block')).toBe('flex block');
    });
});

describe('mergeClasses — input handling', () => {
    it('skips falsy inputs', () => {
        expect(mergeClasses('p-4', false, null, undefined, '', 'm-2')).toBe('p-4 m-2');
    });

    it('returns empty for all-falsy / empty', () => {
        expect(mergeClasses()).toBe('');
        expect(mergeClasses(false, null, undefined, '')).toBe('');
        expect(mergeClasses('   ')).toBe('');
    });

    it('splits on any whitespace and dedupes an exact duplicate', () => {
        expect(mergeClasses('p-4\n  m-2', 'p-4')).toBe('m-2 p-4');
    });

    it('overrides arbitrary values of a single-property utility', () => {
        expect(mergeClasses('w-[337px]', 'w-[400px]')).toBe('w-[400px]');
    });

    it('treats important / negative markers as the same utility for override', () => {
        expect(mergeClasses('mt-2', '-mt-4')).toBe('-mt-4');
        expect(mergeClasses('p-2', '!p-8')).toBe('!p-8');
    });
});

describe('mergeClasses — mangle-aware (the reason this exists)', () => {
    afterEach(() => {
        (globalThis as { __csszyx?: unknown }).__csszyx = undefined;
    });

    const withDecode = (map: Record<string, string>) => {
        (globalThis as { __csszyx?: { decode: (c: string) => string | undefined } }).__csszyx = {
            decode: c => map[c],
        };
    };

    it('overrides two MANGLED classes of the same utility', () => {
        // q3 = gap-2, q7 = gap-8 → q7 wins, returned in its mangled form
        withDecode({ q3: 'gap-2', q7: 'gap-8' });
        expect(mergeClasses('q3', 'q7')).toBe('q7');
    });

    it('keeps mangled classes of different utilities', () => {
        withDecode({ q3: 'gap-2', q9: 'p-4' });
        expect(mergeClasses('q3', 'q9')).toBe('q3 q9');
    });

    it('handles a mangled default + a raw (unmangled) literal override', () => {
        withDecode({ q3: 'gap-2' });
        // q3 (gap-2) and a raw flex-1 literal — different utilities, both kept
        expect(mergeClasses('q3 flex-1', 'm-4')).toBe('q3 flex-1 m-4');
    });

    it('falls back to the token itself when no decode map is present', () => {
        // production-without-map / dev: tokens are already original names
        expect(mergeClasses('gap-2', 'gap-8')).toBe('gap-8');
    });
});

describe('mergeClasses — custom @theme semantic colors', () => {
    // bg-warning / bg-danger are both background-color (the `bg` prefix). Today
    // `bg` is in the ambiguous set, so they under-merge (safe). This documents
    // the v1 behavior; a future conflict-group pass could override them.
    it('under-merges semantic background colors (v1 ambiguous bg)', () => {
        expect(mergeClasses('bg-warning', 'bg-danger')).toBe('bg-warning bg-danger');
    });

    it('still overrides an unambiguous text-adjacent utility like leading', () => {
        expect(mergeClasses('leading-4', 'leading-8')).toBe('leading-8');
    });
});
