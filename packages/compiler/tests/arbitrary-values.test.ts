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

import { transform } from '../src/transform-core.js';
import { expectParity } from './tri-engine-harness.js';

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
                position: 'absolute',
                top: '-1px',
                left: '-1px',
                w: 2,
                h: 2,
                borderT: 2,
                borderL: 2,
            },
            after: {
                content: "''",
                position: 'absolute',
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
// CSS function calls — any function, not a hand-kept list of names
// ============================================================================

/**
 * The bracket rule used to enumerate function names, and the two engines had
 * already drifted apart on which ones they knew. `env()` was in neither list,
 * so `pt: 'env(safe-area-inset-top)'` compiled to `pt-env(safe-area-inset-top)`
 * — not a class Tailwind serves — while `pt: 'calc(…)'` compiled correctly.
 */
describe('arbitrary values — CSS function calls', () => {
    const bracketed: Array<[string, Record<string, unknown>, string]> = [
        [
            'env, the reported gap',
            { pt: 'env(safe-area-inset-top)' },
            'pt-[env(safe-area-inset-top)]',
        ],
        [
            'oklch, known to one engine only',
            { bg: 'oklch(0.7,0.1,200)' },
            'bg-[oklch(0.7,0.1,200)]',
        ],
        ['lab, known to one engine only', { bg: 'lab(50%,40,59)' }, 'bg-[lab(50%,40,59)]'],
        ['fit-content, in no list at all', { w: 'fit-content(200px)' }, 'w-[fit-content(200px)]'],
        ['repeat, in no list at all', { gridCols: 'repeat(3,1fr)' }, 'grid-cols-[repeat(3,1fr)]'],
        ['calc, the one that always worked', { pt: 'calc(1rem+2px)' }, 'pt-[calc(1rem+2px)]'],
        [
            'a negative gradient keeps its sign inside the brackets',
            { mask: '-linear-gradient(black,transparent)' },
            'mask-[-linear-gradient(black,transparent)]',
        ],
    ];
    for (const [name, sz, expected] of bracketed) {
        it(`brackets ${name}`, () => {
            expect(t(sz as Parameters<typeof transform>[0])).toBe(expected);
        });
    }

    it('leaves the Tailwind build-time call and the variable shorthand bare', () => {
        // `--spacing(4)` is Tailwind's own call and `(--x)` is its CSS-variable
        // shorthand; bracketing either would break the utility.
        expect(t({ p: '--spacing(4)' })).toBe('p-[--spacing(4)]');
        expect(t({ pt: '(--gap)' })).toBe('pt-(--gap)');
    });

    it('leaves a utility value that ENDS in the variable shorthand bare', () => {
        // `thumb-(--c)` is one utility value, not a call: the paren is preceded
        // by the utility separator and followed by the custom-property dashes,
        // which is exactly where `var(--x)` has a name character instead.
        expect(t({ scrollbar: 'thumb-(--c)' })).toBe('scrollbar-thumb-(--c)');
        expect(t({ mask: 'size-(--s)' })).toBe('mask-size-(--s)');
        // The discriminator really is that pair of characters.
        expect(t({ pt: 'var(--x)' })).toBe('pt-[var(--x)]');
    });

    it('reads a parenthesis with nothing in front of it as no call at all', () => {
        // The variable shorthand can sit anywhere in a multi-part value, not
        // only at its start, and there is no name in front of the paren to walk
        // back over. Treating the scan's empty answer as a hit would call every
        // such value a function.
        expect(t({ shadow: '0 0 (--c)' })).toBe('shadow-[0_0_(--c)]');
        expect(t({ pt: '1px (--gap)' })).toBe('pt-[1px_(--gap)]');
    });

    it('leaves a value with no function call alone', () => {
        expect(t({ bg: 'red-500' })).toBe('bg-red-500');
        expect(t({ m: '4' })).toBe('m-4');
    });
});

describe('arbitrary values — CSS function calls agree across engines', () => {
    // The name lists were per-engine, so the same value could bracket on one
    // lane and emit a dead class on another. One rule, three engines.
    it.each([
        ["{ pt: 'env(safe-area-inset-top)' }", 'pt-[env(safe-area-inset-top)]'],
        ["{ bg: 'oklch(0.7,0.1,200)' }", 'bg-[oklch(0.7,0.1,200)]'],
        ["{ w: 'fit-content(200px)' }", 'w-[fit-content(200px)]'],
        ["{ p: '--spacing(4)' }", 'p-[--spacing(4)]'],
        ["{ pt: '(--gap)' }", 'pt-(--gap)'],
        ["{ scrollbar: 'thumb-(--c)' }", 'scrollbar-thumb-(--c)'],
        ["{ pt: 'var(--x)' }", 'pt-[var(--x)]'],
    ])('%s', (sz, expected) => {
        expectParity(sz, expected);
    });
});
