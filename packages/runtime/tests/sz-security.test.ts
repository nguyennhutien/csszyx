/**
 * Security tests for the runtime sz helpers: bounded recursion (no stack-overflow
 * DoS from deeply nested untrusted input) and prototype-pollution-safe merges.
 */

import { SzDepthError } from '@csszyx/compiler/browser';
import { describe, expect, it } from 'vitest';
import { _sz, _szMerge } from '../src/concatenate.js';
import { szv } from '../src/variants.js';

function nestArray(n: number): unknown {
    let a: unknown = ['p-4'];
    for (let i = 0; i < n; i++) {
        a = [a];
    }
    return a;
}

function nestObject(n: number): Record<string, unknown> {
    let o: Record<string, unknown> = { p: 4 };
    for (let i = 0; i < n; i++) {
        o = { hover: o };
    }
    return o;
}

describe('runtime recursion limits', () => {
    it('_sz throws SzDepthError on a deeply nested array (no stack overflow)', () => {
        expect(() => _sz(nestArray(5000) as never)).toThrow(SzDepthError);
    });

    it('_szMerge throws SzDepthError on a deeply nested array', () => {
        expect(() => _szMerge(nestArray(5000) as never)).toThrow(SzDepthError);
    });

    it('normal nested arrays still flatten correctly', () => {
        expect(_sz(['a', ['b', 'c']])).toBe('a b c');
        expect(_szMerge(['a', ['b', 'a']])).toBe('a b');
    });

    it('szv throws SzDepthError when base and variant nest too deep', () => {
        const deep = nestObject(5000);
        const factory = szv({ base: deep, variants: { v: { on: deep } } } as never);
        expect(() => factory({ v: 'on' } as never)).toThrow(SzDepthError);
    });
});

describe('prototype-pollution-safe merge', () => {
    it('szv does not pollute Object.prototype via a JSON __proto__ key', () => {
        const evil = JSON.parse('{"__proto__":{"polluted":"yes"}}');
        const factory = szv({ variants: { v: { on: evil } } } as never);
        factory({ v: 'on' } as never);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('szv ignores a __proto__ selection key without polluting', () => {
        const sel = JSON.parse('{"__proto__":"x","variant":"a"}');
        const factory = szv({ variants: { variant: { a: { p: 4 } } } } as never);
        const out = factory(sel);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(out).toEqual({ p: 4 });
    });

    it('valid nested merges are unaffected', () => {
        const factory = szv({
            base: { hover: { bg: 'a' } },
            variants: { v: { on: { hover: { text: 'b' } } } },
        } as never);
        expect(factory({ v: 'on' } as never)).toEqual({ hover: { bg: 'a', text: 'b' } });
    });
});
