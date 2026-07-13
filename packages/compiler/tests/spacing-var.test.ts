/**
 * __szSpacingVar / __szUnitVar — the canonical runtime resolvers for dynamic
 * SPACING/ANGLE/DURATION values. Each case pins the CSS the helper must
 * produce for a value shape the sz type system accepts on these keys; the
 * table mirrors what the static path emits for the same literals.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { __szSpacingVar, __szUnitVar } from '../src/spacing-var.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('__szSpacingVar', () => {
    it('multiplies numbers and numeric strings onto the spacing scale', () => {
        expect(__szSpacingVar(32, 'w')).toBe('calc(32 * var(--spacing))');
        expect(__szSpacingVar(-4, 'm')).toBe('calc(-4 * var(--spacing))');
        expect(__szSpacingVar(2.5, 'p')).toBe('calc(2.5 * var(--spacing))');
        expect(__szSpacingVar('32', 'w')).toBe('calc(32 * var(--spacing))');
        expect(__szSpacingVar('-4', 'm')).toBe('calc(-4 * var(--spacing))');
    });

    it('resolves fractions to percentages (w-3/12 parity)', () => {
        expect(__szSpacingVar('3/12', 'w')).toBe('calc(3 / 12 * 100%)');
        expect(__szSpacingVar('1/2', 'basis')).toBe('calc(1 / 2 * 100%)');
    });

    it('resolves named tokens to their static-class CSS values', () => {
        expect(__szSpacingVar('full', 'w')).toBe('100%');
        expect(__szSpacingVar('min', 'w')).toBe('min-content');
        expect(__szSpacingVar('max', 'h')).toBe('max-content');
        expect(__szSpacingVar('fit', 'w')).toBe('fit-content');
        expect(__szSpacingVar('auto', 'm')).toBe('auto');
        expect(__szSpacingVar('px', 'p')).toBe('1px');
    });

    it('resolves screen per axis from the key', () => {
        expect(__szSpacingVar('screen', 'w')).toBe('100vw');
        expect(__szSpacingVar('screen', 'maxW')).toBe('100vw');
        expect(__szSpacingVar('screen', 'basis')).toBe('100vw');
        expect(__szSpacingVar('screen', 'h')).toBe('100vh');
        expect(__szSpacingVar('screen', 'minH')).toBe('100vh');
        // Off the sizing axes the static class generates nothing either.
        expect(__szSpacingVar('screen', 'p')).toBeUndefined();
    });

    it('passes raw CSS lengths, percentages, keywords, and functions through', () => {
        expect(__szSpacingVar('100%', 'w')).toBe('100%');
        expect(__szSpacingVar('32px', 'w')).toBe('32px');
        expect(__szSpacingVar('4rem', 'p')).toBe('4rem');
        expect(__szSpacingVar('max-content', 'w')).toBe('max-content');
        expect(__szSpacingVar('calc(100% - 2rem)', 'w')).toBe('calc(100% - 2rem)');
        expect(__szSpacingVar('var(--sidebar)', 'w')).toBe('var(--sidebar)');
    });

    it('omits nullish/false values silently (conditional-value convention)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(__szSpacingVar(undefined, 'w')).toBeUndefined();
        expect(__szSpacingVar(null, 'w')).toBeUndefined();
        expect(__szSpacingVar(false, 'w')).toBeUndefined();
        expect(__szSpacingVar('', 'w')).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    it('omits non-finite numbers', () => {
        expect(__szSpacingVar(Number.NaN, 'w')).toBeUndefined();
        expect(__szSpacingVar(Number.POSITIVE_INFINITY, 'w')).toBeUndefined();
    });

    it('warns once per key/shape when the value cannot be resolved', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(__szSpacingVar({ sm: 4, md: 8 }, 'spacingvartestkey')).toBeUndefined();
        expect(__szSpacingVar({ lg: 2 }, 'spacingvartestkey')).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('spacingvartestkey');
        expect(warn.mock.calls[0][0]).toContain('dynamic()');
    });
});

describe('__szUnitVar', () => {
    it('appends the unit to bare numbers and numeric strings', () => {
        expect(__szUnitVar(45, 'deg', 'rotate')).toBe('45deg');
        expect(__szUnitVar(-90, 'deg', 'rotate')).toBe('-90deg');
        expect(__szUnitVar('45', 'deg', 'rotate')).toBe('45deg');
        expect(__szUnitVar(150, 'ms', 'duration')).toBe('150ms');
    });

    it('passes already-united strings through instead of doubling the unit', () => {
        expect(__szUnitVar('45deg', 'deg', 'rotate')).toBe('45deg');
        expect(__szUnitVar('0.5turn', 'deg', 'rotate')).toBe('0.5turn');
        expect(__szUnitVar('150ms', 'ms', 'duration')).toBe('150ms');
        expect(__szUnitVar('var(--speed)', 'ms', 'duration')).toBe('var(--speed)');
    });

    it('omits nullish values silently and warns on unresolvable shapes', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(__szUnitVar(undefined, 'deg', 'rotate')).toBeUndefined();
        expect(__szUnitVar(null, 'ms', 'delay')).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
        expect(__szUnitVar({ from: 0 }, 'deg', 'unitvartestkey')).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('omits non-finite numbers', () => {
        expect(__szUnitVar(Number.NaN, 'deg', 'rotate')).toBeUndefined();
    });
});
