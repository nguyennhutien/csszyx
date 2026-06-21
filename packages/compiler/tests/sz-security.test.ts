/**
 * Security tests for the compiler sz transform: bounded recursion (a deeply
 * nested sz object becomes a catchable SzDepthError, not a stack-overflow crash)
 * and prototype-pollution-safe color stripping.
 */

import { describe, expect, it } from 'vitest';
import { stripInvalidColorStrings } from '../src/color-validation.js';
import { SzDepthError, transform } from '../src/transform-core.js';

function nestObject(n: number): Record<string, unknown> {
    let o: Record<string, unknown> = { p: 4 };
    for (let i = 0; i < n; i++) {
        o = { hover: o };
    }
    return o;
}

describe('compiler recursion limits', () => {
    it('transform throws SzDepthError on a deeply nested sz object', () => {
        expect(() => transform(nestObject(5000) as never)).toThrow(SzDepthError);
    });

    it('stripInvalidColorStrings throws SzDepthError on deep nesting', () => {
        expect(() => stripInvalidColorStrings(nestObject(5000))).toThrow(SzDepthError);
    });

    it('the depth counter resets between top-level calls (a normal call after a deep one still works)', () => {
        expect(() => transform(nestObject(5000) as never)).toThrow(SzDepthError);
        expect(transform({ p: 4 }).className).toBe('p-4');
    });

    it('normal nested variants still transform', () => {
        expect(transform({ hover: { bg: 'blue-500' } }).className).toBe('hover:bg-blue-500');
    });
});

describe('prototype-pollution-safe color stripping', () => {
    it('stripInvalidColorStrings does not pollute Object.prototype via JSON __proto__', () => {
        const evil = JSON.parse('{"__proto__":{"polluted":"yes"},"p":"4"}');
        const out = stripInvalidColorStrings(evil);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(out.p).toBe('4');
        expect(Object.hasOwn(out, '__proto__')).toBe(false);
    });
});
