import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    __resetSzWarnDedupForTests,
    deepMergeSzObjects,
    PROPERTY_MAP,
    transform,
    variantStringPrefix,
} from '../src/transform-core.js';

beforeEach(() => {
    __resetSzWarnDedupForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('runtime values at lowering boundaries', () => {
    it('replaces a mask angle family with sides, and sides with an angle family', () => {
        expect(
            deepMergeSzObjects(
                { maskLinear: { angle: 45, from: 10 } },
                { maskLinear: { b: { to: 80 } } },
            ),
        ).toEqual({ maskLinear: { b: { to: 80 } } });
        expect(
            deepMergeSzObjects({ maskLinear: { t: { from: 10 } } }, { maskLinear: { angle: 90 } }),
        ).toEqual({ maskLinear: { angle: 90 } });
    });
    it('rejects unknown aria states instead of treating them as built-in variants', () => {
        expect(variantStringPrefix('aria-imaginary')).toBeNull();
        expect(variantStringPrefix('data-')).toBeNull();
    });
    it('lowers a CSS-wide color without a generated capability row', () => {
        expect(transform({ bg: 'unset' }).className).toBe('bg-unset');
    });
    it("writes a colour object with the key's utility prefix, which every key has", () => {
        expect(transform({ bg: { color: 'red-500', op: 50 } }).className).toBe('bg-red-500/50');
        expect(transform({ borderColor: { color: 'red-500', op: 50 } }).className).toBe(
            'border-red-500/50',
        );
        // The colour-object path takes the prefix from PROPERTY_MAP without a
        // fallback, so an empty entry would write a class with no utility.
        expect(Object.entries(PROPERTY_MAP).filter(([, prefix]) => !prefix)).toEqual([]);
    });
    it.each([
        ['origin', 'origin'],
        ['ease', 'ease'],
        ['animate', 'animate'],
        ['filter', 'filter'],
        ['backdropFilter', 'backdrop-filter'],
        ['dropShadow', 'drop-shadow'],
    ])('keeps the mapped prefix of complex %s values', (key, prefix) => {
        expect(transform({ [key]: 'calc(1 + 2)' }).className).toBe(`${prefix}-[calc(1_+_2)]`);
    });
    it('keeps the existing mask family when an incoming mask object is empty', () => {
        expect(deepMergeSzObjects({ maskLinear: { angle: 45 } }, { maskLinear: {} })).toEqual({
            maskLinear: { angle: 45 },
        });
    });
    it('strips important before recognizing a moved stand-alone group value', () => {
        expect(transform({ contain: 'size!', containPaint: true }).className).toBe('contain-paint');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('closed-enum-value'));
    });
    it('ignores a scalar used as a named group definition', () => {
        expect(transform({ group: { card: true } }).className).toBe('');
    });
    it('ignores an invalid mask stop without dropping other stops', () => {
        expect(transform({ maskLinear: { from: true, to: 80 } }).className).toBe(
            'mask-linear-to-80',
        );
    });
    it('emits a string mask angle', () => {
        expect(transform({ maskLinear: { angle: '45' } }).className).toBe('mask-linear-45');
    });
    it('ignores numeric container values', () => {
        expect(transform({ container: 2 }).className).toBe('');
    });
    it('still warns about invalid keys when the host provides no stack', () => {
        const original = Error.prepareStackTrace;
        Error.prepareStackTrace = () => undefined;
        try {
            expect(transform({ notARealKey: 1 }).className).toBe('not-areal-key-1');
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('unknown-key'));
        } finally {
            Error.prepareStackTrace = original;
        }
    });
});
