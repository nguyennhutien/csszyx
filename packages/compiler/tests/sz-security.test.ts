/**
 * Security tests for the compiler sz transform: bounded recursion (a deeply
 * nested sz object becomes a catchable SzDepthError, not a stack-overflow crash)
 * and an sz object parsed from JSON that cannot pollute the prototype.
 */

import { describe, expect, it } from 'vitest';
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

    it('the depth counter resets between top-level calls (a normal call after a deep one still works)', () => {
        expect(() => transform(nestObject(5000) as never)).toThrow(SzDepthError);
        expect(transform({ p: 4 }).className).toBe('p-4');
    });

    it('normal nested variants still transform', () => {
        expect(transform({ hover: { bg: 'blue-500' } }).className).toBe('hover:bg-blue-500');
    });
});

describe('prototype-pollution-safe transform', () => {
    it('does not pollute Object.prototype through a JSON __proto__ key', () => {
        const evil = JSON.parse('{"__proto__":{"polluted":"yes"},"p":"4"}');
        expect(transform(evil).className).toBe('p-4');
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
});
