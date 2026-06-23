import { afterEach, describe, expect, it } from 'vitest';
import { szcn } from '../src/merge-classes.js';

// szcn is the single resolution point for a layered design-system
// component (Box < Flex < Row/Col): combine default classes with the forwarded
// override, last-wins per utility, while staying mangle-aware (unlike npm
// tailwind-merge). These lock the override contract + the fail-safe
// (never drop a class we can't confidently group).

describe('szcn — single-property override (last wins)', () => {
    it('overrides the same utility, keeps unrelated classes', () => {
        expect(szcn('gap-2 p-4', 'gap-8')).toBe('p-4 gap-8');
    });

    it('concatenates when there is no collision', () => {
        expect(szcn('m-4', 'p-2')).toBe('m-4 p-2');
    });

    it('overrides spacing/sizing/rounded by prefix', () => {
        expect(szcn('p-2', 'p-8')).toBe('p-8');
        expect(szcn('w-1/2', 'w-full')).toBe('w-full');
        expect(szcn('rounded-md', 'rounded-xl')).toBe('rounded-xl');
    });

    it('keeps the last occurrence position for an overridden utility', () => {
        // gap-2 then m-4 then gap-8 → gap survivor takes gap-8's later slot
        expect(szcn('gap-2 m-4 gap-8')).toBe('m-4 gap-8');
    });
});

describe('szcn — variant isolation', () => {
    it('does not let a base utility override its responsive variant', () => {
        expect(szcn('gap-2', 'md:gap-8')).toBe('gap-2 md:gap-8');
    });

    it('overrides within the same responsive variant', () => {
        expect(szcn('md:gap-2', 'md:gap-8')).toBe('md:gap-8');
    });

    it('isolates state variants from the base and each other', () => {
        expect(szcn('gap-2', 'hover:gap-8')).toBe('gap-2 hover:gap-8');
        expect(szcn('hover:p-2', 'hover:p-8')).toBe('hover:p-8');
    });

    it('keeps responsive + state combos distinct', () => {
        expect(szcn('md:hover:p-2 p-1', 'p-8')).toBe('md:hover:p-2 p-8');
    });
});

describe('szcn — fail-safe: never drop an ambiguous/unknown class', () => {
    it('under-merges flex-* (flex shorthand vs flex-direction are different properties)', () => {
        expect(szcn('flex-1', 'flex-row')).toBe('flex-1 flex-row');
    });

    it('under-merges text-* (font-size vs text-color)', () => {
        expect(szcn('text-sm', 'text-red-500')).toBe('text-sm text-red-500');
    });

    it('under-merges bg-* (color vs position vs size)', () => {
        expect(szcn('bg-red-500', 'bg-cover')).toBe('bg-red-500 bg-cover');
    });

    it('never drops an unrecognized custom class', () => {
        expect(szcn('my-custom-thing', 'p-4')).toBe('my-custom-thing p-4');
        expect(szcn('a b', 'c')).toBe('a b c');
    });

    it('under-merges exact value-keyed display tokens (flex vs block)', () => {
        // both set `display`, but the box-role map keys them only by category,
        // so they are under-merged rather than risk dropping a sibling.
        expect(szcn('flex', 'block')).toBe('flex block');
    });
});

describe('szcn — directional shorthand/longhand override (padding/margin)', () => {
    it('a later longhand refines an earlier shorthand (keeps both)', () => {
        // default p-4, override pb-8 → padding all + bottom override
        expect(szcn('p-4', 'pb-8')).toBe('p-4 pb-8');
        expect(szcn('m-8', 'mb-2')).toBe('m-8 mb-2');
    });

    it('a later shorthand overrides an earlier longhand it subsumes', () => {
        // default pb-4, override p-8 → p-8 wins (the reverse-direction fix)
        expect(szcn('pb-4', 'p-8')).toBe('p-8');
        expect(szcn('mt-2', 'm-8')).toBe('m-8');
    });

    it('a later mid-axis shorthand overrides the longhands it covers', () => {
        expect(szcn('pl-4', 'px-2')).toBe('px-2'); // px covers pl/pr
        expect(szcn('px-2', 'pl-4')).toBe('px-2 pl-4'); // pl refines px-left
    });

    it('keeps distinct shorthand + non-covered longhand', () => {
        expect(szcn('p-4', 'px-2')).toBe('p-4 px-2'); // px refines x
        expect(szcn('px-2', 'p-4')).toBe('p-4'); // p subsumes px
    });

    it('isolates directional coverage by variant', () => {
        // a base p-8 must not remove an md: longhand, and vice-versa
        expect(szcn('md:pb-4', 'p-8')).toBe('md:pb-4 p-8');
        expect(szcn('p-4', 'md:p-8')).toBe('p-4 md:p-8');
    });

    it('does not let padding coverage touch margin', () => {
        expect(szcn('mb-4', 'p-8')).toBe('mb-4 p-8');
    });
});

describe('szcn — directional override (inset / rounded)', () => {
    it('inset subsumes axis + physical sides; refinement keeps both', () => {
        expect(szcn('top-0', 'inset-0')).toBe('inset-0');
        expect(szcn('inset-x-2', 'inset-0')).toBe('inset-0');
        expect(szcn('inset-0', 'top-4')).toBe('inset-0 top-4');
        expect(szcn('left-0', 'inset-x-2')).toBe('inset-x-2');
        expect(szcn('inset-x-2', 'left-0')).toBe('inset-x-2 left-0');
        expect(szcn('inset-x-2', 'top-4')).toBe('inset-x-2 top-4'); // x vs y → both
    });

    it('rounded subsumes edges + corners; refinement keeps both', () => {
        expect(szcn('rounded-t-sm', 'rounded-lg')).toBe('rounded-lg');
        expect(szcn('rounded-tl-sm', 'rounded-t-lg')).toBe('rounded-t-lg');
        expect(szcn('rounded-lg', 'rounded-t-sm')).toBe('rounded-lg rounded-t-sm');
        expect(szcn('rounded-tl-sm', 'rounded-r-lg')).toBe('rounded-tl-sm rounded-r-lg'); // tl ∉ r
    });

    it('keeps logical sides/corners separate from physical (RTL-safe under-merge)', () => {
        // start/end (logical) and rounded-s/e are a different CSS longhand that can
        // flip under RTL, so they are not crossed with physical — keep both.
        expect(szcn('start-0', 'inset-0')).toBe('start-0 inset-0');
        expect(szcn('rounded-s-lg', 'rounded-lg')).toBe('rounded-s-lg rounded-lg');
    });

    it('does not let inset coverage touch rounded or spacing', () => {
        expect(szcn('rounded-lg', 'inset-0')).toBe('rounded-lg inset-0');
        expect(szcn('p-4', 'inset-0')).toBe('p-4 inset-0');
    });
});

describe('szcn — input handling', () => {
    it('skips falsy inputs', () => {
        expect(szcn('p-4', false, null, undefined, '', 'm-2')).toBe('p-4 m-2');
    });

    it('returns empty for all-falsy / empty', () => {
        expect(szcn()).toBe('');
        expect(szcn(false, null, undefined, '')).toBe('');
        expect(szcn('   ')).toBe('');
    });

    it('splits on any whitespace and dedupes an exact duplicate', () => {
        expect(szcn('p-4\n  m-2', 'p-4')).toBe('m-2 p-4');
    });

    it('overrides arbitrary values of a single-property utility', () => {
        expect(szcn('w-[337px]', 'w-[400px]')).toBe('w-[400px]');
    });

    it('treats important / negative markers as the same utility for override', () => {
        expect(szcn('mt-2', '-mt-4')).toBe('-mt-4');
        expect(szcn('p-2', '!p-8')).toBe('!p-8');
    });
});

describe('szcn — mangle-aware (the reason this exists)', () => {
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
        expect(szcn('q3', 'q7')).toBe('q7');
    });

    it('keeps mangled classes of different utilities', () => {
        withDecode({ q3: 'gap-2', q9: 'p-4' });
        expect(szcn('q3', 'q9')).toBe('q3 q9');
    });

    it('handles a mangled default + a raw (unmangled) literal override', () => {
        withDecode({ q3: 'gap-2' });
        // q3 (gap-2) and a raw flex-1 literal — different utilities, both kept
        expect(szcn('q3 flex-1', 'm-4')).toBe('q3 flex-1 m-4');
    });

    it('falls back to the token itself when no decode map is present', () => {
        // production-without-map / dev: tokens are already original names
        expect(szcn('gap-2', 'gap-8')).toBe('gap-8');
    });
});

describe('szcn — custom @theme semantic colors', () => {
    // bg-warning / bg-danger are both background-color (the `bg` prefix). Today
    // `bg` is in the ambiguous set, so they under-merge (safe). This documents
    // the v1 behavior; a future conflict-group pass could override them.
    it('under-merges semantic background colors (v1 ambiguous bg)', () => {
        expect(szcn('bg-warning', 'bg-danger')).toBe('bg-warning bg-danger');
    });

    it('still overrides an unambiguous text-adjacent utility like leading', () => {
        expect(szcn('leading-4', 'leading-8')).toBe('leading-8');
    });
});
