/**
 * Tests for concatenate module.
 */

import { describe, expect, it } from 'vitest';

import { _sz, _sz2, _sz3, _szIf, _szMerge, _szSwitch } from '../src/concatenate.js';

describe('_sz', () => {
    it('should concatenate multiple classes', () => {
        expect(_sz('a', 'b', 'c')).toBe('a b c');
    });

    it('should filter out null values', () => {
        expect(_sz('a', null, 'b')).toBe('a b');
    });

    it('should filter out undefined values', () => {
        expect(_sz('a', undefined, 'b')).toBe('a b');
    });

    it('should filter out false values', () => {
        expect(_sz('a', false, 'b')).toBe('a b');
    });

    it('should handle empty input', () => {
        expect(_sz()).toBe('');
    });

    it('should handle all falsy values', () => {
        expect(_sz(null, undefined, false)).toBe('');
    });

    it('should handle mixed truthy and falsy', () => {
        expect(_sz('a', null, 'b', false, 'c', undefined)).toBe('a b c');
    });

    it('should work with conditionals', () => {
        const isActive = true;
        const hasError = false;
        expect(_sz('base', isActive && 'active', hasError && 'error')).toBe('base active');
    });
});

describe('_sz2', () => {
    it('should concatenate two classes', () => {
        expect(_sz2('a', 'b')).toBe('a b');
    });

    it('should handle empty first argument', () => {
        expect(_sz2('', 'b')).toBe('b');
    });

    it('should handle empty second argument', () => {
        expect(_sz2('a', '')).toBe('a');
    });

    it('should handle both empty', () => {
        expect(_sz2('', '')).toBe('');
    });
});

describe('_sz3', () => {
    it('should concatenate three classes', () => {
        expect(_sz3('a', 'b', 'c')).toBe('a b c');
    });

    it('should handle empty values', () => {
        expect(_sz3('a', '', 'c')).toBe('a c');
        expect(_sz3('', 'b', 'c')).toBe('b c');
        expect(_sz3('a', 'b', '')).toBe('a b');
    });

    it('should handle all empty', () => {
        expect(_sz3('', '', '')).toBe('');
    });
});

describe('_szIf', () => {
    it('should return className when condition is true', () => {
        expect(_szIf(true, 'active')).toBe('active');
    });

    it('should return empty string when condition is false', () => {
        expect(_szIf(false, 'active')).toBe('');
    });

    it('should return fallback when condition is false', () => {
        expect(_szIf(false, 'active', 'inactive')).toBe('inactive');
    });

    it('should work with _sz', () => {
        expect(_sz('base', _szIf(true, 'active'))).toBe('base active');
        expect(_sz('base', _szIf(false, 'active'))).toBe('base');
    });
});

describe('_szSwitch', () => {
    it('should return first matching condition', () => {
        const result = _szSwitch([
            [false, 'first'],
            [true, 'second'],
            [true, 'third'],
        ]);
        expect(result).toBe('second');
    });

    it('should return default when no conditions match', () => {
        const result = _szSwitch(
            [
                [false, 'first'],
                [false, 'second'],
            ],
            'default',
        );
        expect(result).toBe('default');
    });

    it('should return empty string when no default', () => {
        const result = _szSwitch([
            [false, 'first'],
            [false, 'second'],
        ]);
        expect(result).toBe('');
    });

    it('should work with status values', () => {
        const status: string = 'error';
        const result = _szSwitch(
            [
                [status === 'success', 'text-green-500'],
                [status === 'error', 'text-red-500'],
                [status === 'warning', 'text-yellow-500'],
            ],
            'text-gray-500',
        );
        expect(result).toBe('text-red-500');
    });
});

describe('_szMerge', () => {
    it('should merge multiple className strings', () => {
        expect(_szMerge('a b', 'c d')).toBe('a b c d');
    });

    it('should remove duplicates', () => {
        expect(_szMerge('a b', 'b c', 'c d')).toBe('a b c d');
    });

    it('should handle empty strings', () => {
        expect(_szMerge('a', '', 'b')).toBe('a b');
    });

    it('should handle single input', () => {
        expect(_szMerge('a b c')).toBe('a b c');
    });

    it('should handle no inputs', () => {
        expect(_szMerge()).toBe('');
    });

    it('should preserve order of first occurrence', () => {
        expect(_szMerge('c b a', 'a b c')).toBe('c b a');
    });

    it('should handle multiple spaces', () => {
        expect(_szMerge('a  b   c', 'd  e')).toBe('a b c d e');
    });
});
