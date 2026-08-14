/**
 * __szBoolClass — the canonical runtime resolver for dynamic values on
 * boolean-only keys (border/ring/outline/truncate/shadow family). The
 * compiler emits it instead of the css-var strategy for these keys: React
 * discards booleans in `style`, and the valued utility (`border-b-(--var)`)
 * targets a different CSS property than the bare class (`border-b`), so the
 * only correct lowering is a conditional bare class.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { __szBoolClass } from '../src/bool-class.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('__szBoolClass', () => {
    it('returns the compiled class for true', () => {
        expect(__szBoolClass(true, 'borderB', 'border-b')).toBe('border-b');
        expect(__szBoolClass(true, 'truncate', 'truncate')).toBe('truncate');
        // Variant chains ride the class argument, not the helper.
        expect(__szBoolClass(true, 'ring', 'hover:ring')).toBe('hover:ring');
    });

    it('returns an empty string silently for false and absent values', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // `false` is a MEANINGFUL "off" here (no border), unlike the spacing
        // helper where false is only the conditional-value carve-out.
        expect(__szBoolClass(false, 'borderB', 'border-b')).toBe('');
        expect(__szBoolClass(null, 'borderB', 'border-b')).toBe('');
        expect(__szBoolClass(undefined, 'ring', 'ring')).toBe('');
        expect(__szBoolClass('', 'outline', 'outline')).toBe('');
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns and omits for numbers, strings, and objects', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(__szBoolClass(2, 'boolclasstestnum', 'truncate')).toBe('');
        expect(__szBoolClass('px', 'boolclassteststr', 'border-b')).toBe('');
        expect(__szBoolClass({ sm: true }, 'boolclasstestobj', 'ring')).toBe('');
        expect(warn).toHaveBeenCalledTimes(3);
        expect(warn.mock.calls[0][0]).toContain('boolclasstestnum');
        expect(warn.mock.calls[0][0]).toContain('dynamic()');
    });

    it('warns once per key/shape pair', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(__szBoolClass(4, 'boolclasstestdedup', 'border-b')).toBe('');
        expect(__szBoolClass(8, 'boolclasstestdedup', 'border-b')).toBe('');
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
