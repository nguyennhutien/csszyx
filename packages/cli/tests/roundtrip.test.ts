/**
 * Round-trip tests: TW class → migration CLI → sz object → compiler → same TW class.
 * Verifies that the migration produces valid sz objects that compile back correctly.
 */
import { describe, expect, it } from 'vitest';

import { type SzObject, transform } from '../../compiler/src/transform.js';
import { classNameToSzObject } from '../src/migrate/variant-parser.js';

/**
 * Round-trip a Tailwind class through migration.
 * @param twClass - The Tailwind class string.
 * @returns {string} Compiled className output.
 */
function roundTrip(twClass: string): string {
    const { szObject } = classNameToSzObject(twClass);
    const result = transform(szObject as SzObject);
    return result.className;
}

describe('round-trip: TW → migrate → compile', () => {
    // ========================================================================
    // SPACING
    // ========================================================================
    describe('spacing', () => {
        it.each([
            'p-4', 'p-0', 'p-0.5', 'p-px',
            'pt-4', 'pr-2', 'pb-8', 'pl-1', 'px-6', 'py-3',
            'm-4', 'm-auto', 'mt-2', 'mx-auto',
            'gap-4', 'gap-x-2', 'gap-y-8',
            'space-x-4', 'space-y-2',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });

        it.each([
            '-mt-4', '-ml-2', '-m-1', '-space-x-4',
        ])('negative: %s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // SIZING
    // ========================================================================
    describe('sizing', () => {
        it.each([
            'w-4', 'w-full', 'w-screen', 'w-auto',
            'h-16', 'h-full', 'h-screen',
            'min-w-0', 'min-h-screen', 'max-h-full',
            'size-4', 'size-full',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // TYPOGRAPHY
    // ========================================================================
    describe('typography', () => {
        it.each([
            'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl',
            'text-left', 'text-center', 'text-right', 'text-justify',
            'text-red-500', 'text-blue-600', 'text-white',
            'font-bold', 'font-semibold', 'font-normal',
            'font-sans', 'font-serif', 'font-mono',
            'leading-6', 'leading-tight', 'leading-none',
            'tracking-tight', 'tracking-wide',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // BACKGROUND
    // ========================================================================
    describe('background', () => {
        it.each([
            'bg-blue-500', 'bg-white', 'bg-red-600',
            'bg-center', 'bg-top', 'bg-bottom',
            'bg-cover', 'bg-contain', 'bg-auto',
            'bg-repeat', 'bg-no-repeat',
            'bg-fixed', 'bg-local', 'bg-scroll',
            'bg-clip-text', 'bg-clip-border',
            'bg-origin-border', 'bg-origin-padding',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // BORDERS
    // ========================================================================
    describe('borders', () => {
        it.each([
            'border-0', 'border-2', 'border-4', 'border-8',
            'border-solid', 'border-dashed', 'border-dotted',
            'border-red-500', 'border-gray-200',
            'rounded-lg', 'rounded-full', 'rounded-none',
            'rounded-t-lg', 'rounded-tl-md',
            'ring-2',
            'outline-2', 'outline-dashed',
            'outline-offset-2',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // LAYOUT
    // ========================================================================
    describe('layout', () => {
        it.each([
            'z-10', 'z-50',
            'inset-0', 'inset-x-4', 'inset-y-0',
            'top-0', 'right-4',
            'overflow-hidden', 'overflow-auto',
            'overflow-x-auto', 'overflow-y-scroll',
            'object-cover', 'object-contain',
            'aspect-square', 'aspect-video',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // BOOLEAN CLASSES
    // ========================================================================
    describe('boolean classes', () => {
        it.each([
            'block', 'flex', 'grid', 'hidden', 'inline',
            'static', 'fixed', 'absolute', 'relative', 'sticky',
            'visible', 'invisible',
            'truncate', 'uppercase', 'lowercase', 'capitalize',
            'underline', 'italic',
            'container',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // FLEXBOX & GRID
    // ========================================================================
    describe('flexbox & grid', () => {
        it.each([
            'flex-row', 'flex-col', 'flex-row-reverse',
            'justify-center', 'justify-between',
            'items-center', 'items-start',
            'self-end',
            'grid-cols-3', 'grid-cols-12', 'grid-rows-4',
            'col-span-3', 'col-start-2', 'col-end-4',
            'row-span-2',
            'gap-4', 'gap-x-2',
            'place-content-center', 'place-items-center',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // EFFECTS & FILTERS
    // ========================================================================
    describe('effects & filters', () => {
        it.each([
            'shadow-sm', 'shadow-lg', 'shadow-none',
            'opacity-50', 'opacity-0', 'opacity-100',
            'hue-rotate-90',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // TRANSFORMS
    // ========================================================================
    describe('transforms', () => {
        it.each([
            'scale-50', 'scale-100',
            'rotate-45', 'rotate-90',
            '-rotate-45',
            'translate-x-4',
            '-translate-x-4',
            'skew-x-3', 'skew-y-6',
            'origin-center', 'origin-top',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // TRANSITIONS
    // ========================================================================
    describe('transitions', () => {
        it.each([
            'transition-all', 'transition-colors', 'transition-none',
            'duration-150', 'duration-300',
            'ease-in', 'ease-out', 'ease-in-out',
            'delay-100', 'delay-500',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // INTERACTIVITY
    // ========================================================================
    describe('interactivity', () => {
        it.each([
            'cursor-pointer', 'cursor-default',
            'select-none', 'select-text',
            'pointer-events-none', 'pointer-events-auto',
        ])('%s', (cls) => {
            expect(roundTrip(cls)).toBe(cls);
        });
    });

    // ========================================================================
    // VARIANTS
    // ========================================================================
    describe('variants', () => {
        it('hover variant', () => {
            expect(roundTrip('hover:bg-blue-600')).toBe('hover:bg-blue-600');
        });

        it('responsive + state', () => {
            expect(roundTrip('md:hover:bg-blue-600')).toBe('md:hover:bg-blue-600');
        });

        it('dark mode', () => {
            expect(roundTrip('dark:bg-gray-800')).toBe('dark:bg-gray-800');
        });

        it('focus-visible', () => {
            expect(roundTrip('focus-visible:ring-2')).toBe('focus-visible:ring-2');
        });
    });

    // ========================================================================
    // GRADIENTS
    // ========================================================================
    describe('gradients', () => {
        it('bg-linear-to-r', () => {
            expect(roundTrip('bg-linear-to-r')).toBe('bg-linear-to-r');
        });

        it('bg-radial', () => {
            expect(roundTrip('bg-radial')).toBe('bg-radial');
        });

        it('bg-conic', () => {
            expect(roundTrip('bg-conic')).toBe('bg-conic');
        });

        it('bg-linear-45', () => {
            expect(roundTrip('bg-linear-45')).toBe('bg-linear-45');
        });

        it('-bg-linear-30', () => {
            expect(roundTrip('-bg-linear-30')).toBe('-bg-linear-30');
        });
    });

    // ========================================================================
    // MULTI-CLASS ROUND-TRIPS
    // ========================================================================
    describe('multi-class', () => {
        it('button component', () => {
            const input = 'px-4 py-2 bg-blue-500 rounded-md';
            const { szObject } = classNameToSzObject(input);
            const result = transform(szObject as SzObject);
            // All classes should be present (order may vary)
            const resultClasses = result.className.split(' ').sort();
            const inputClasses = input.split(' ').sort();
            expect(resultClasses).toEqual(inputClasses);
        });

        it('card component', () => {
            const input = 'p-4 bg-white rounded-lg shadow-md';
            const { szObject } = classNameToSzObject(input);
            const result = transform(szObject as SzObject);
            const resultClasses = result.className.split(' ').sort();
            const inputClasses = input.split(' ').sort();
            expect(resultClasses).toEqual(inputClasses);
        });
    });

    // ========================================================================
    // COMPILER BRACKET-FREE ROUND-TRIP
    // ========================================================================
    describe('bracket-free keys round-trip', () => {
        it('min-[320px]:flex', () => {
            const { szObject } = classNameToSzObject('min-[320px]:flex');
            // szObject = { min: { '320px': { flex: true } } }  — no brackets!
            expect((szObject.min as Record<string, unknown>)['320px']).toBeDefined();
            expect((szObject.min as Record<string, unknown>)['[320px]']).toBeUndefined();
            // Compiler should auto-wrap in []
            const result = transform(szObject as SzObject);
            expect(result.className).toBe('min-[320px]:flex');
        });

        it('max-[600px]:hidden', () => {
            const { szObject } = classNameToSzObject('max-[600px]:hidden');
            const result = transform(szObject as SzObject);
            expect(result.className).toBe('max-[600px]:hidden');
        });
    });
});
