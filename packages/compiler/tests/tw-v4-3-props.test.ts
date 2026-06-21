/**
 * Tests for Tailwind CSS v4.1–v4.3 new utility props and variants.
 * Covers: scrollbar, scrollbarThumb/Track, scrollbarGutter, zoom, tabSize,
 * mask gradient color stops, and v4.1 variants.
 */

import { describe, expect, it } from 'vitest';

import { PROPERTY_CATEGORY_MAP, PropertyCategory } from '../src/property-types.js';
import { transform } from '../src/transform.js';

// ============================================================================
// Scrollbar (v4.3)
// ============================================================================

describe('scrollbar (v4.3)', () => {
    it('{ scrollbar: "auto" } → scrollbar-auto', () => {
        expect(transform({ scrollbar: 'auto' }).className).toBe('scrollbar-auto');
    });

    it('{ scrollbar: "thin" } → scrollbar-thin', () => {
        expect(transform({ scrollbar: 'thin' }).className).toBe('scrollbar-thin');
    });

    it('{ scrollbar: "none" } → scrollbar-none', () => {
        expect(transform({ scrollbar: 'none' }).className).toBe('scrollbar-none');
    });
});

// ============================================================================
// Scrollbar Thumb Color (v4.3)
// ============================================================================

describe('scrollbarThumb (v4.3)', () => {
    it('{ scrollbarThumb: "gray-400" } → scrollbar-thumb-gray-400', () => {
        expect(transform({ scrollbarThumb: 'gray-400' }).className).toBe(
            'scrollbar-thumb-gray-400',
        );
    });

    it('handles CSS variable', () => {
        expect(transform({ scrollbarThumb: '--thumb' }).className).toBe(
            'scrollbar-thumb-(--thumb)',
        );
    });

    it('handles hex color', () => {
        expect(transform({ scrollbarThumb: '#aaa' }).className).toBe('scrollbar-thumb-[#aaa]');
    });

    it('is COLOR category', () => {
        expect(PROPERTY_CATEGORY_MAP.scrollbarThumb).toBe(PropertyCategory.COLOR);
    });
});

// ============================================================================
// Scrollbar Track Color (v4.3)
// ============================================================================

describe('scrollbarTrack (v4.3)', () => {
    it('{ scrollbarTrack: "gray-200" } → scrollbar-track-gray-200', () => {
        expect(transform({ scrollbarTrack: 'gray-200' }).className).toBe(
            'scrollbar-track-gray-200',
        );
    });

    it('handles CSS variable', () => {
        expect(transform({ scrollbarTrack: '--track' }).className).toBe(
            'scrollbar-track-(--track)',
        );
    });

    it('is COLOR category', () => {
        expect(PROPERTY_CATEGORY_MAP.scrollbarTrack).toBe(PropertyCategory.COLOR);
    });
});

// ============================================================================
// Scrollbar Gutter (v4.3)
// ============================================================================

describe('scrollbarGutter (v4.3)', () => {
    it('{ scrollbarGutter: "auto" } → scrollbar-gutter-auto', () => {
        expect(transform({ scrollbarGutter: 'auto' }).className).toBe('scrollbar-gutter-auto');
    });

    it('{ scrollbarGutter: "stable" } → scrollbar-gutter-stable', () => {
        expect(transform({ scrollbarGutter: 'stable' }).className).toBe('scrollbar-gutter-stable');
    });

    it('{ scrollbarGutter: "both" } → scrollbar-gutter-both', () => {
        expect(transform({ scrollbarGutter: 'both' }).className).toBe('scrollbar-gutter-both');
    });
});

// ============================================================================
// Zoom (v4.3)
// ============================================================================

describe('zoom (v4.3)', () => {
    it('{ zoom: 75 } → zoom-75', () => {
        expect(transform({ zoom: 75 }).className).toBe('zoom-75');
    });

    it('{ zoom: 100 } → zoom-100', () => {
        expect(transform({ zoom: 100 }).className).toBe('zoom-100');
    });

    it('{ zoom: 150 } → zoom-150', () => {
        expect(transform({ zoom: 150 }).className).toBe('zoom-150');
    });

    it('handles decimal string value', () => {
        expect(transform({ zoom: '1.1' }).className).toBe('zoom-1.1');
    });

    it('handles CSS variable', () => {
        expect(transform({ zoom: '--z' }).className).toBe('zoom-(--z)');
    });

    it('is UNITLESS category', () => {
        expect(PROPERTY_CATEGORY_MAP.zoom).toBe(PropertyCategory.UNITLESS);
    });
});

// ============================================================================
// Tab Size (v4.3)
// ============================================================================

describe('tabSize (v4.3)', () => {
    it('{ tabSize: 2 } → tab-2', () => {
        expect(transform({ tabSize: 2 }).className).toBe('tab-2');
    });

    it('{ tabSize: 4 } → tab-4', () => {
        expect(transform({ tabSize: 4 }).className).toBe('tab-4');
    });

    it('{ tabSize: 8 } → tab-8', () => {
        expect(transform({ tabSize: 8 }).className).toBe('tab-8');
    });

    it('handles arbitrary value', () => {
        expect(transform({ tabSize: '12px' }).className).toBe('tab-[12px]');
    });

    it('handles CSS variable', () => {
        expect(transform({ tabSize: '--ts' }).className).toBe('tab-(--ts)');
    });

    it('is UNITLESS category', () => {
        expect(PROPERTY_CATEGORY_MAP.tabSize).toBe(PropertyCategory.UNITLESS);
    });
});

// ============================================================================
// Mask Gradient Color Stops (v4.1)
// ============================================================================

describe('mask gradient color stops (v4.1)', () => {
    it('{ maskFrom: "black" } → mask-from-black', () => {
        expect(transform({ maskFrom: 'black' }).className).toBe('mask-from-black');
    });

    it('{ maskVia: "transparent" } → mask-via-transparent', () => {
        expect(transform({ maskVia: 'transparent' }).className).toBe('mask-via-transparent');
    });

    it('{ maskTo: "white" } → mask-to-white', () => {
        expect(transform({ maskTo: 'white' }).className).toBe('mask-to-white');
    });

    it('handles CSS variable', () => {
        expect(transform({ maskFrom: '--c' }).className).toBe('mask-from-(--c)');
    });

    it('maskFrom is COLOR category', () => {
        expect(PROPERTY_CATEGORY_MAP.maskFrom).toBe(PropertyCategory.COLOR);
    });

    it('maskVia is COLOR category', () => {
        expect(PROPERTY_CATEGORY_MAP.maskVia).toBe(PropertyCategory.COLOR);
    });

    it('maskTo is COLOR category', () => {
        expect(PROPERTY_CATEGORY_MAP.maskTo).toBe(PropertyCategory.COLOR);
    });
});

// ============================================================================
// v4.1 Variants
// ============================================================================

describe('any-pointer variants (v4.1)', () => {
    it('{ anyPointerFine: { cursor: "pointer" } } → any-pointer-fine:cursor-pointer', () => {
        expect(transform({ anyPointerFine: { cursor: 'pointer' } }).className).toBe(
            'any-pointer-fine:cursor-pointer',
        );
    });

    it('{ anyPointerCoarse: { p: 8 } } → any-pointer-coarse:p-8', () => {
        expect(transform({ anyPointerCoarse: { p: 8 } }).className).toBe('any-pointer-coarse:p-8');
    });

    it('{ anyPointerNone: { display: "none" } } → any-pointer-none:hidden', () => {
        expect(transform({ anyPointerNone: { display: 'none' } }).className).toBe(
            'any-pointer-none:hidden',
        );
    });
});

describe('user-valid / user-invalid variants (v4.1)', () => {
    it('{ userValid: { borderColor: "green-500" } } → user-valid:border-green-500', () => {
        expect(transform({ userValid: { borderColor: 'green-500' } }).className).toBe(
            'user-valid:border-green-500',
        );
    });

    it('{ userInvalid: { borderColor: "red-500" } } → user-invalid:border-red-500', () => {
        expect(transform({ userInvalid: { borderColor: 'red-500' } }).className).toBe(
            'user-invalid:border-red-500',
        );
    });
});

describe('details-content variant (v4.1)', () => {
    it('{ detailsContent: { display: "block" } } → details-content:block', () => {
        expect(transform({ detailsContent: { display: 'block' } }).className).toBe(
            'details-content:block',
        );
    });
});

describe('inverted-colors variant (v4.1)', () => {
    it('{ invertedColors: { invert: true } } → inverted-colors:invert', () => {
        expect(transform({ invertedColors: { invert: true } }).className).toBe(
            'inverted-colors:invert',
        );
    });
});

describe('noscript variant (v4.1)', () => {
    it('{ noscript: { display: "block" } } → noscript:block', () => {
        expect(transform({ noscript: { display: 'block' } }).className).toBe('noscript:block');
    });
});
