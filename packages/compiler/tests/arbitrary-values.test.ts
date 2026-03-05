/**
 * Tests for bracket-free arbitrary value syntax.
 *
 * sz arbitrary values: no [] required — the compiler auto-wraps.
 *   { top: '-1px' }  →  top-[-1px]
 *   { top: '27px' }  →  top-[27px]
 *
 * This covers layout positioning (top/right/bottom/left/inset),
 * and arbitrary values inside pseudo-element variants (before:/after:).
 */

import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

// ============================================================================
// Positive unit strings — already worked before this file, regression guard
// ============================================================================

describe('arbitrary values — positive units (regression)', () => {
    it('top: "27px" → top-[27px]', () => {
        expect(t({ top: '27px' })).toBe('top-[27px]');
    });

    it('left: "1.5rem" → left-[1.5rem]', () => {
        expect(t({ left: '1.5rem' })).toBe('left-[1.5rem]');
    });

    it('bottom: "50%" → bottom-[50%]', () => {
        expect(t({ bottom: '50%' })).toBe('bottom-[50%]');
    });

    it('inset: "27px" → inset-[27px]', () => {
        expect(t({ inset: '27px' })).toBe('inset-[27px]');
    });

    it('top: "calc(100% - 1rem)" → top-[calc(100%_-_1rem)]', () => {
        expect(t({ top: 'calc(100% - 1rem)' })).toBe('top-[calc(100%_-_1rem)]');
    });
});

// ============================================================================
// Negative unit strings — the main fix: no [] needed in sz
// ============================================================================

describe('arbitrary values — negative units bracket-free', () => {
    it('top: "-1px" → top-[-1px]', () => {
        expect(t({ top: '-1px' })).toBe('top-[-1px]');
    });

    it('left: "-1px" → left-[-1px]', () => {
        expect(t({ left: '-1px' })).toBe('left-[-1px]');
    });

    it('bottom: "-1px" → bottom-[-1px]', () => {
        expect(t({ bottom: '-1px' })).toBe('bottom-[-1px]');
    });

    it('right: "-1px" → right-[-1px]', () => {
        expect(t({ right: '-1px' })).toBe('right-[-1px]');
    });

    it('top: "-2rem" → top-[-2rem]', () => {
        expect(t({ top: '-2rem' })).toBe('top-[-2rem]');
    });

    it('top: "-1.5rem" → top-[-1.5rem]', () => {
        expect(t({ top: '-1.5rem' })).toBe('top-[-1.5rem]');
    });

    it('top: "-100%" → top-[-100%]', () => {
        expect(t({ top: '-100%' })).toBe('top-[-100%]');
    });

    it('top: "-.5em" → top-[-.5em]', () => {
        expect(t({ top: '-.5em' })).toBe('top-[-.5em]');
    });

    it('inset: "-1px" → inset-[-1px]', () => {
        expect(t({ inset: '-1px' })).toBe('inset-[-1px]');
    });

    it('insetX: "-8px" → inset-x-[-8px]', () => {
        expect(t({ insetX: '-8px' })).toBe('inset-x-[-8px]');
    });
});

// ============================================================================
// Negative units inside before:/after: pseudo-element variants
// ============================================================================

describe('arbitrary values — negative units in before:/after: variants', () => {
    it('before top: "-1px" → before:top-[-1px]', () => {
        expect(t({ before: { top: '-1px' } })).toBe('before:top-[-1px]');
    });

    it('before left: "-1px" → before:left-[-1px]', () => {
        expect(t({ before: { left: '-1px' } })).toBe('before:left-[-1px]');
    });

    it('after bottom: "-1px" → after:bottom-[-1px]', () => {
        expect(t({ after: { bottom: '-1px' } })).toBe('after:bottom-[-1px]');
    });

    it('after right: "-1px" → after:right-[-1px]', () => {
        expect(t({ after: { right: '-1px' } })).toBe('after:right-[-1px]');
    });

    it('full Panel corner markers — before/after with negative px positions', () => {
        const result = t({
            before: {
                content: "''",
                absolute: true,
                top: '-1px',
                left: '-1px',
                w: 2,
                h: 2,
                borderT: 2,
                borderL: 2,
            },
            after: {
                content: "''",
                absolute: true,
                bottom: '-1px',
                right: '-1px',
                w: 2,
                h: 2,
                borderB: 2,
                borderR: 2,
            },
        });
        expect(result).toContain('before:top-[-1px]');
        expect(result).toContain('before:left-[-1px]');
        expect(result).toContain('after:bottom-[-1px]');
        expect(result).toContain('after:right-[-1px]');
    });
});

// ============================================================================
// User-provided brackets still pass through (backward compat)
// ============================================================================

describe('arbitrary values — user-provided brackets pass through', () => {
    it('top: "[-1px]" (user-provided) → top-[-1px]', () => {
        expect(t({ top: '[-1px]' })).toBe('top-[-1px]');
    });

    it('left: "[2rem]" (user-provided) → left-[2rem]', () => {
        expect(t({ left: '[2rem]' })).toBe('left-[2rem]');
    });
});
