/**
 * A later shorthand removes the longhands it writes over.
 *
 * `gap-4` sets `gap`, which is `row-gap` and `column-gap` together, so a `gap-4`
 * written after `gap-x-1` leaves nothing of the earlier class — but the merge
 * kept both, and the stylesheet then decided the horizontal gap. `scroll-m-*`
 * and `scroll-p-*` have the same shape: the shorthand covers the axis and side
 * utilities under it.
 *
 * The coverage each of these writes was read from the project's own Tailwind
 * (`gap-4` → `gap`; `gap-x-4` → `column-gap`; `scroll-m-4` → `scroll-margin`;
 * `scroll-mx-4` → `scroll-margin-inline`), not recalled. The reverse direction
 * is pinned in every case, because a longhand written after a shorthand refines
 * it and both must survive.
 */
import { describe, expect, it } from 'vitest';

import { _szcn } from '../src/merge-classes.js';

describe('gap', () => {
    it('lets a later gap replace an axis gap', () => {
        expect(_szcn('gap-x-1', 'gap-4')).toBe('gap-4');
        expect(_szcn('gap-y-8', 'gap-4')).toBe('gap-4');
        expect(_szcn('gap-x-1 gap-y-2', 'gap-4')).toBe('gap-4');
    });

    it('keeps an axis gap written after the shorthand', () => {
        expect(_szcn('gap-4', 'gap-x-1')).toBe('gap-4 gap-x-1');
    });

    it('leaves the two axes independent of each other', () => {
        expect(_szcn('gap-x-1', 'gap-y-2')).toBe('gap-x-1 gap-y-2');
        expect(_szcn('gap-x-1', 'gap-x-4')).toBe('gap-x-4');
    });
});

describe('scroll margin and padding', () => {
    it('lets a later shorthand replace the axis and side utilities', () => {
        expect(_szcn('scroll-mx-2', 'scroll-m-4')).toBe('scroll-m-4');
        expect(_szcn('scroll-mt-2', 'scroll-m-4')).toBe('scroll-m-4');
        expect(_szcn('scroll-px-2', 'scroll-p-4')).toBe('scroll-p-4');
        expect(_szcn('scroll-pt-2', 'scroll-py-4')).toBe('scroll-py-4');
    });

    it('keeps a side written after the shorthand', () => {
        expect(_szcn('scroll-m-4', 'scroll-mt-2')).toBe('scroll-m-4 scroll-mt-2');
    });

    it('keeps scroll margin and scroll padding apart', () => {
        expect(_szcn('scroll-m-4', 'scroll-p-4')).toBe('scroll-m-4 scroll-p-4');
    });
});
