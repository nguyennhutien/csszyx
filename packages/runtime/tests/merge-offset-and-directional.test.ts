/**
 * A leading `offset-` or side segment names a utility of its own.
 *
 * `ring-offset-gray-800` is not a ring colour: it sets `--tw-ring-offset-color`
 * while `ring-blue-500` sets `--tw-ring-color`, and both survive in CSS. The
 * classifier read the value after `ring-` whole, found a colour in it, and
 * keyed both as the ring colour — so the later one deleted the earlier, and the
 * focus ring an app wrote lost its colour with nothing said. The same shape
 * reaches `border-t-4` beside `border-t-transparent`, where a side segment made
 * the classifier give up and the width was dropped by the fallback.
 *
 * The pairs below are all shapes Tailwind's own documentation writes: a ring
 * with an offset, a side border with a colour. Each case pins BOTH orders, so a
 * rule that keeps the pair by accident in one direction cannot pass.
 */
import { describe, expect, it } from 'vitest';

import { _szcn } from '../src/merge-classes.js';

describe('an offset utility is not the thing it offsets', () => {
    it('keeps a ring colour beside a ring-offset colour', () => {
        expect(_szcn('ring-blue-500', 'ring-offset-gray-800')).toBe(
            'ring-blue-500 ring-offset-gray-800',
        );
        expect(_szcn('ring-offset-gray-800', 'ring-blue-500')).toBe(
            'ring-offset-gray-800 ring-blue-500',
        );
    });

    it('keeps a ring width beside a ring-offset width', () => {
        expect(_szcn('ring-2', 'ring-offset-2')).toBe('ring-2 ring-offset-2');
    });

    it('still merges two ring-offset colours, and two ring colours', () => {
        expect(_szcn('ring-offset-gray-800', 'ring-offset-red-500')).toBe('ring-offset-red-500');
        expect(_szcn('ring-blue-500', 'ring-red-500')).toBe('ring-red-500');
    });

    it('keeps a ring-offset width beside a ring-offset colour', () => {
        expect(_szcn('ring-offset-2', 'ring-offset-gray-800')).toBe(
            'ring-offset-2 ring-offset-gray-800',
        );
    });

    it('carries the whole focus-ring idiom through untouched', () => {
        // Verbatim from Tailwind's ring documentation, and the shape Flowbite
        // writes on every focusable control.
        expect(_szcn('outline-none ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-800')).toBe(
            'outline-none ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-800',
        );
    });

    it('merges two outline offsets while leaving the outline itself alone', () => {
        expect(_szcn('outline-offset-2', 'outline-offset-4')).toBe('outline-offset-4');
        expect(_szcn('outline-2', 'outline-offset-2')).toBe('outline-2 outline-offset-2');
    });
});

describe('a side segment keeps its own width, colour and style', () => {
    it('keeps a side width beside a side colour', () => {
        expect(_szcn('border-t-4', 'border-t-transparent')).toBe('border-t-4 border-t-transparent');
        expect(_szcn('border-t-transparent', 'border-t-4')).toBe('border-t-transparent border-t-4');
    });

    it('still merges two widths and two colours on the same side', () => {
        expect(_szcn('border-t-4', 'border-t-8')).toBe('border-t-8');
        expect(_szcn('border-t-red-500', 'border-t-blue-500')).toBe('border-t-blue-500');
    });

    it('leaves a different side alone', () => {
        expect(_szcn('border-t-4', 'border-b-8')).toBe('border-t-4 border-b-8');
    });

    it('treats a bare side utility as a width', () => {
        expect(_szcn('border-t', 'border-t-4')).toBe('border-t-4');
        expect(_szcn('border-t', 'border-t-red-500')).toBe('border-t border-t-red-500');
    });

    it('keeps the divide reverse flag beside a divide width', () => {
        expect(_szcn('divide-x-2', 'divide-x-reverse')).toBe('divide-x-2 divide-x-reverse');
        expect(_szcn('divide-x-2', 'divide-x-4')).toBe('divide-x-4');
    });
});
