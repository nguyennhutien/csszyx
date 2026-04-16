/**
 * Tests for the user-provided-brackets guard.
 *
 * Rule: sz prop VALUES must NEVER contain outer []. The compiler auto-wraps.
 * If a user accidentally writes { top: '[-1px]' } or { w: '[100px]' }, the
 * compiler must strip the brackets and produce the same output as the
 * bracket-free form.
 *
 * The guard lives in two places:
 *   - normalizeArbitraryValue()   — strips brackets before whitespace encoding
 *   - needsArbitraryBrackets()    — strips brackets before pattern detection
 *     (prevents double-wrapping like top-[[-1px]] or perspective-[[500px]])
 */

import { describe, expect, it } from 'vitest';

import { transform } from '../src/transform.js';
import { normalizeArbitraryValue } from '../src/transform-core.js';

const t = (sz: Parameters<typeof transform>[0]): string => transform(sz).className;

// ============================================================================
// normalizeArbitraryValue — unit tests for the stripping helper
// ============================================================================

describe('normalizeArbitraryValue — bracket stripping', () => {
    it('strips outer [] from a plain unit', () => {
        expect(normalizeArbitraryValue('[100px]')).toBe('100px');
    });

    it('strips outer [] from a negative unit', () => {
        expect(normalizeArbitraryValue('[-1px]')).toBe('-1px');
    });

    it('strips outer [] from a hex color', () => {
        expect(normalizeArbitraryValue('[#316ff6]')).toBe('#316ff6');
    });

    it('strips outer [] from rgba()', () => {
        expect(normalizeArbitraryValue('[rgba(10,10,15,0.5)]')).toBe('rgba(10,10,15,0.5)');
    });

    it('strips outer [] and normalises inner spaces', () => {
        expect(normalizeArbitraryValue('[calc(100% - 1rem)]')).toBe('calc(100%_-_1rem)');
    });

    it('leaves a value without brackets unchanged', () => {
        expect(normalizeArbitraryValue('100px')).toBe('100px');
    });

    it('still trims and encodes spaces in values without outer brackets', () => {
        expect(normalizeArbitraryValue('calc(100% - 1rem)')).toBe('calc(100%_-_1rem)');
    });

    it('does NOT strip inner [] — only outer wrapping pair', () => {
        // '[&>span]' is an arbitrary VARIANT KEY, not a value — but just in case
        // someone passes a value like 'url([data])' we must not corrupt it
        expect(normalizeArbitraryValue('url([data])')).toBe('url([data])');
    });

    it('handles empty brackets []', () => {
        // Degenerate input — strip produces empty string (no change to outer logic)
        expect(normalizeArbitraryValue('[]')).toBe('');
    });
});

// ============================================================================
// Width / height / sizing — user adds brackets around plain units
// ============================================================================

describe('user brackets — sizing props', () => {
    it('w: "[100px]" → w-[100px]  (same as w: "100px")', () => {
        expect(t({ w: '[100px]' })).toBe(t({ w: '100px' }));
        expect(t({ w: '[100px]' })).toBe('w-[100px]');
    });

    it('h: "[60px]" → h-[60px]', () => {
        expect(t({ h: '[60px]' })).toBe('h-[60px]');
    });

    it('w: "[1.5rem]" → w-[1.5rem]', () => {
        expect(t({ w: '[1.5rem]' })).toBe('w-[1.5rem]');
    });

    it('w: "[50%]" → w-[50%]', () => {
        expect(t({ w: '[50%]' })).toBe('w-[50%]');
    });

    it('maxW: "[720px]" → max-w-[720px]', () => {
        expect(t({ maxW: '[720px]' })).toBe('max-w-[720px]');
    });

    it('size: "[3rem]" → size-[3rem]', () => {
        expect(t({ size: '[3rem]' })).toBe(t({ size: '3rem' }));
    });
});

// ============================================================================
// Positioning — main case from the bug report
// ============================================================================

describe('user brackets — positioning props', () => {
    it('top: "[-1px]" → top-[-1px]  (same as top: "-1px")', () => {
        expect(t({ top: '[-1px]' })).toBe(t({ top: '-1px' }));
        expect(t({ top: '[-1px]' })).toBe('top-[-1px]');
    });

    it('left: "[-1px]" → left-[-1px]', () => {
        expect(t({ left: '[-1px]' })).toBe('left-[-1px]');
    });

    it('bottom: "[20px]" → bottom-[20px]', () => {
        expect(t({ bottom: '[20px]' })).toBe('bottom-[20px]');
    });

    it('right: "[2rem]" → right-[2rem]', () => {
        expect(t({ right: '[2rem]' })).toBe('right-[2rem]');
    });

    it('inset: "[-8px]" → inset-[-8px]', () => {
        expect(t({ inset: '[-8px]' })).toBe('inset-[-8px]');
    });

    it('insetX: "[12px]" → inset-x-[12px]', () => {
        expect(t({ insetX: '[12px]' })).toBe('inset-x-[12px]');
    });
});

// ============================================================================
// Colors — most dangerous case (double-wrapping without the guard)
// ============================================================================

describe('user brackets — color props', () => {
    it('bg: "[#316ff6]" → bg-[#316ff6]  (no double brackets)', () => {
        expect(t({ bg: '[#316ff6]' })).toBe('bg-[#316ff6]');
    });

    it('bg: "[rgba(10,10,15,0.5)]" → bg-[rgba(10,10,15,0.5)]', () => {
        expect(t({ bg: '[rgba(10,10,15,0.5)]' })).toBe('bg-[rgba(10,10,15,0.5)]');
    });

    it('bg: "[hsl(220,14%,10%)]" → bg-[hsl(220,14%,10%)]', () => {
        expect(t({ bg: '[hsl(220,14%,10%)]' })).toBe('bg-[hsl(220,14%,10%)]');
    });

    it('color: "[#fff]" → text-[#fff]', () => {
        expect(t({ color: '[#fff]' })).toBe('text-[#fff]');
    });

    it('borderColor: "[rgba(0,0,0,0.15)]" → border-[rgba(0,0,0,0.15)]', () => {
        expect(t({ borderColor: '[rgba(0,0,0,0.15)]' })).toBe('border-[rgba(0,0,0,0.15)]');
    });
});

// ============================================================================
// calc() / var() / clamp() — function values
// ============================================================================

describe('user brackets — CSS function values', () => {
    it('w: "[calc(100%-20px)]" → w-[calc(100%-20px)]', () => {
        expect(t({ w: '[calc(100%-20px)]' })).toBe('w-[calc(100%-20px)]');
    });

    it('w: "[calc(100% - 1rem)]" strips brackets AND encodes spaces', () => {
        expect(t({ w: '[calc(100% - 1rem)]' })).toBe('w-[calc(100%_-_1rem)]');
    });

    it('top: "[var(--offset)]" → top-[var(--offset)]', () => {
        expect(t({ top: '[var(--offset)]' })).toBe('top-[var(--offset)]');
    });

    it('w: "[clamp(200px,50%,800px)]" → w-[clamp(200px,50%,800px)]', () => {
        expect(t({ w: '[clamp(200px,50%,800px)]' })).toBe('w-[clamp(200px,50%,800px)]');
    });

    it('w: "[min(50%,300px)]" → w-[min(50%,300px)]', () => {
        expect(t({ w: '[min(50%,300px)]' })).toBe('w-[min(50%,300px)]');
    });

    it('w: "[max(200px,30vw)]" → w-[max(200px,30vw)]', () => {
        expect(t({ w: '[max(200px,30vw)]' })).toBe('w-[max(200px,30vw)]');
    });
});

// ============================================================================
// Misc prop types — decoration, perspective, etc.
// ============================================================================

describe('user brackets — decoration / perspective', () => {
    it('decorationThickness: "[3px]" → decoration-[3px]  (was double-wrapping)', () => {
        expect(t({ decorationThickness: '[3px]' })).toBe('decoration-[3px]');
    });

    it('perspective: "[500px]" → perspective-[500px]  (was double-wrapping)', () => {
        expect(t({ perspective: '[500px]' })).toBe('perspective-[500px]');
    });

    it('ease: "[cubic-bezier(0.4,0,0.2,1)]" → ease-[cubic-bezier(0.4,0,0.2,1)]', () => {
        expect(t({ ease: '[cubic-bezier(0.4,0,0.2,1)]' })).toBe(
            t({ ease: 'cubic-bezier(0.4,0,0.2,1)' }),
        );
    });
});

// ============================================================================
// Pseudo-element variants — nested bracket values
// ============================================================================

describe('user brackets — inside before:/after: variants', () => {
    it('before top: "[-1px]" → before:top-[-1px]', () => {
        expect(t({ before: { top: '[-1px]' } })).toBe('before:top-[-1px]');
    });

    it('after bg: "[rgba(0,0,0,0.5)]" → after:bg-[rgba(0,0,0,0.5)]', () => {
        expect(t({ after: { bg: '[rgba(0,0,0,0.5)]' } })).toBe('after:bg-[rgba(0,0,0,0.5)]');
    });
});

// ============================================================================
// Idempotency — correct values (no brackets) are UNCHANGED
// ============================================================================

describe('no regression — bracket-free values still work', () => {
    it('top: "-1px" still → top-[-1px]', () => {
        expect(t({ top: '-1px' })).toBe('top-[-1px]');
    });

    it('bg: "#316ff6" still → bg-[#316ff6]', () => {
        expect(t({ bg: '#316ff6' })).toBe('bg-[#316ff6]');
    });

    it('w: "calc(100% - 1rem)" still → w-[calc(100%_-_1rem)]', () => {
        expect(t({ w: 'calc(100% - 1rem)' })).toBe('w-[calc(100%_-_1rem)]');
    });

    it('w: 48 (number) still → w-48', () => {
        expect(t({ w: 48 })).toBe('w-48');
    });

    it('bg: "violet-500" (Tailwind token) still → bg-violet-500', () => {
        expect(t({ bg: 'violet-500' })).toBe('bg-violet-500');
    });
});
