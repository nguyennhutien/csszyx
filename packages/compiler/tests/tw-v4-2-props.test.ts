/**
 * Tests for Tailwind CSS v4.2.0 new utility props.
 * Covers: logical padding/margin block-direction, block/inline sizing,
 * logical insets, block-direction borders, scroll block-direction,
 * fontFeatures, new color names, and the start/end emit change.
 */

import { describe, expect, it } from 'vitest';

import { PROPERTY_CATEGORY_MAP, PropertyCategory } from '../src/property-types.js';
import { transform } from '../src/transform.js';

// ============================================================================
// Padding block-direction
// ============================================================================

describe('pbs / pbe (padding-block-start/end)', () => {
    it('should emit pbs-* class', () => {
        const result = transform({ pbs: 4 });
        expect(result.className).toBe('pbs-4');
    });

    it('should emit pbe-* class', () => {
        const result = transform({ pbe: 8 });
        expect(result.className).toBe('pbe-8');
    });

    it('should handle arbitrary pbs value', () => {
        const result = transform({ pbs: '1.5rem' });
        expect(result.className).toBe('pbs-[1.5rem]');
    });

    it('should be categorized as SPACING', () => {
        expect(PROPERTY_CATEGORY_MAP.pbs).toBe(PropertyCategory.SPACING);
        expect(PROPERTY_CATEGORY_MAP.pbe).toBe(PropertyCategory.SPACING);
    });
});

// ============================================================================
// Margin block-direction
// ============================================================================

describe('mbs / mbe (margin-block-start/end)', () => {
    it('should emit mbs-* class', () => {
        const result = transform({ mbs: 2 });
        expect(result.className).toBe('mbs-2');
    });

    it('should emit mbe-* class', () => {
        const result = transform({ mbe: 6 });
        expect(result.className).toBe('mbe-6');
    });

    it('should handle negative mbs value', () => {
        const result = transform({ mbs: -4 });
        expect(result.className).toBe('-mbs-4');
    });

    it('should be categorized as SPACING', () => {
        expect(PROPERTY_CATEGORY_MAP.mbs).toBe(PropertyCategory.SPACING);
        expect(PROPERTY_CATEGORY_MAP.mbe).toBe(PropertyCategory.SPACING);
    });
});

// ============================================================================
// Block / inline sizing
// ============================================================================

describe('blockSize / inlineSize families', () => {
    it('should emit block-* class for blockSize', () => {
        const result = transform({ blockSize: 'full' });
        expect(result.className).toBe('block-full');
    });

    it('should emit min-block-* class for minBlockSize', () => {
        const result = transform({ minBlockSize: 0 });
        expect(result.className).toBe('min-block-0');
    });

    it('should emit max-block-* class for maxBlockSize', () => {
        const result = transform({ maxBlockSize: 'screen' });
        expect(result.className).toBe('max-block-screen');
    });

    it('should emit inline-* class for inlineSize', () => {
        const result = transform({ inlineSize: 'full' });
        expect(result.className).toBe('inline-full');
    });

    it('should emit min-inline-* class for minInlineSize', () => {
        const result = transform({ minInlineSize: 'fit' });
        expect(result.className).toBe('min-inline-fit');
    });

    it('should emit max-inline-* class for maxInlineSize', () => {
        const result = transform({ maxInlineSize: 'prose' });
        expect(result.className).toBe('max-inline-prose');
    });

    it('should be categorized as SPACING', () => {
        for (const prop of [
            'blockSize',
            'minBlockSize',
            'maxBlockSize',
            'inlineSize',
            'minInlineSize',
            'maxInlineSize',
        ]) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.SPACING);
        }
    });
});

// ============================================================================
// Logical insets
// ============================================================================

describe('insetS / insetE / insetBs / insetBe', () => {
    it('should emit inset-s-* for insetS', () => {
        const result = transform({ insetS: 4 });
        expect(result.className).toBe('inset-s-4');
    });

    it('should emit inset-e-* for insetE', () => {
        const result = transform({ insetE: 0 });
        expect(result.className).toBe('inset-e-0');
    });

    it('should emit inset-bs-* for insetBs', () => {
        const result = transform({ insetBs: 2 });
        expect(result.className).toBe('inset-bs-2');
    });

    it('should emit inset-be-* for insetBe', () => {
        const result = transform({ insetBe: 'auto' });
        expect(result.className).toBe('inset-be-auto');
    });

    it('should be categorized as SPACING', () => {
        for (const prop of ['insetS', 'insetE', 'insetBs', 'insetBe']) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.SPACING);
        }
    });
});

// ============================================================================
// start / end — deprecated class rename (inset-s-* / inset-e-*)
// ============================================================================

describe('start / end emit inset-s-* / inset-e-* (TW v4.2 deprecation)', () => {
    it('should emit inset-s-* for start prop (same CSS, new class name)', () => {
        const result = transform({ start: 4 });
        expect(result.className).toBe('inset-s-4');
    });

    it('should emit inset-e-* for end prop (same CSS, new class name)', () => {
        const result = transform({ end: 0 });
        expect(result.className).toBe('inset-e-0');
    });

    it('should emit inset-s-auto for start: auto', () => {
        const result = transform({ start: 'auto' });
        expect(result.className).toBe('inset-s-auto');
    });

    it('should work in hover variant', () => {
        const result = transform({ hover: { start: 4 } });
        expect(result.className).toBe('hover:inset-s-4');
    });
});

// ============================================================================
// Block-direction borders
// ============================================================================

describe('borderBs / borderBe', () => {
    it('should emit border-bs class for borderBs: true', () => {
        const result = transform({ borderBs: true });
        expect(result.className).toBe('border-bs');
    });

    it('should emit border-bs-2 for borderBs: 2', () => {
        const result = transform({ borderBs: 2 });
        expect(result.className).toBe('border-bs-2');
    });

    it('should emit border-be-4 for borderBe: 4', () => {
        const result = transform({ borderBe: 4 });
        expect(result.className).toBe('border-be-4');
    });

    it('should be categorized as UNITLESS', () => {
        expect(PROPERTY_CATEGORY_MAP.borderBs).toBe(PropertyCategory.UNITLESS);
        expect(PROPERTY_CATEGORY_MAP.borderBe).toBe(PropertyCategory.UNITLESS);
    });
});

// ============================================================================
// Scroll block-direction
// ============================================================================

describe('scrollPbs / scrollPbe / scrollMbs / scrollMbe', () => {
    it('should emit scroll-pbs-* for scrollPbs', () => {
        const result = transform({ scrollPbs: 4 });
        expect(result.className).toBe('scroll-pbs-4');
    });

    it('should emit scroll-pbe-* for scrollPbe', () => {
        const result = transform({ scrollPbe: 8 });
        expect(result.className).toBe('scroll-pbe-8');
    });

    it('should emit scroll-mbs-* for scrollMbs', () => {
        const result = transform({ scrollMbs: 2 });
        expect(result.className).toBe('scroll-mbs-2');
    });

    it('should emit scroll-mbe-* for scrollMbe', () => {
        const result = transform({ scrollMbe: 0 });
        expect(result.className).toBe('scroll-mbe-0');
    });

    it('should be categorized as SPACING', () => {
        for (const prop of ['scrollPbs', 'scrollPbe', 'scrollMbs', 'scrollMbe']) {
            expect(PROPERTY_CATEGORY_MAP[prop]).toBe(PropertyCategory.SPACING);
        }
    });
});

// ============================================================================
// fontFeatures
// ============================================================================

describe('fontFeatures (font-feature-settings)', () => {
    it('should emit the bracketed form for the normal keyword', () => {
        // Tailwind's font-features utility is functional-only: the bare
        // keyword styles nothing while the bracketed form compiles.
        const result = transform({ fontFeatures: 'normal' });
        expect(result.className).toBe('font-features-[normal]');
    });

    it('should emit arbitrary font-features class for feature string', () => {
        const result = transform({ fontFeatures: '"liga" 1' });
        // arbitrary values with quotes need brackets
        expect(result.className).toContain('font-features');
    });

    it('should be categorized as PASSTHROUGH (unknown → pass-through)', () => {
        // fontFeatures is not in PROPERTY_CATEGORY_MAP → PASSTHROUGH
        expect(PROPERTY_CATEGORY_MAP.fontFeatures).toBeUndefined();
    });
});

// ============================================================================
// New color names
// ============================================================================

describe('new color names (mauve, olive, mist, taupe)', () => {
    it('should pass through mauve color in bg', () => {
        const result = transform({ bg: 'mauve-500' });
        expect(result.className).toBe('bg-mauve-500');
    });

    it('should pass through olive color in text', () => {
        const result = transform({ color: 'olive-300' });
        expect(result.className).toBe('text-olive-300');
    });

    it('should pass through mist color in border', () => {
        const result = transform({ borderColor: 'mist-200' });
        expect(result.className).toContain('mist-200');
    });

    it('should pass through taupe color', () => {
        const result = transform({ bg: 'taupe-700' });
        expect(result.className).toBe('bg-taupe-700');
    });
});
