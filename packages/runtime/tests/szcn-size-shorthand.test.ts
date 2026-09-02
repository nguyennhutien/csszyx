/**
 * `size-*` sets width and height at once, so it has to cover `w-*` and `h-*`
 * the way `p-*` covers `px-*` and `pt-*`.
 *
 * Without the entry, a component default `w-full` merged with a caller's
 * `size-8` kept both, and which one won was decided by stylesheet order
 * rather than by the order the caller wrote them — the one case where
 * `szcn`'s "later wins" promise was not kept.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearMangleRegistry } from '../src/mangle-registry.js';
import { szcn } from '../src/merge-classes.js';

beforeEach(() => clearMangleRegistry());

describe('size as a shorthand over w and h', () => {
    it('drops an earlier width or height when size comes later', () => {
        expect(szcn('w-full', 'size-8')).toBe('size-8');
        expect(szcn('h-10', 'size-8')).toBe('size-8');
        expect(szcn('w-full h-10 p-2', 'size-8')).toBe('p-2 size-8');
    });

    it('keeps an earlier size when a longhand comes later', () => {
        // The asymmetry every shorthand entry has: a later longhand narrows
        // the shorthand instead of replacing it, so both stay and cascade.
        expect(szcn('size-8', 'w-full')).toBe('size-8 w-full');
    });

    it('collapses size against size', () => {
        expect(szcn('size-8', 'size-16')).toBe('size-16');
    });

    it('does not reach min or max sizing', () => {
        expect(szcn('min-w-0', 'size-8')).toBe('min-w-0 size-8');
        expect(szcn('max-h-screen', 'size-8')).toBe('max-h-screen size-8');
    });
});
