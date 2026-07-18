/**
 * Coverage for the DOM-independent hydration helpers: the mangle-map validator
 * (a security-sensitive type guard) and the client-side-recovery toggle.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
    disableCSRRecovery,
    enableCSRRecovery,
    isCSRRecoveryAllowed,
    isValidMangleMap,
} from '../src/hydration.js';

describe('isValidMangleMap', () => {
    it('accepts an empty object', () => {
        expect(isValidMangleMap({})).toBe(true);
    });

    it('accepts a string→string map', () => {
        expect(isValidMangleMap({ 'gap-8': 'q7', 'p-4': 'a1' })).toBe(true);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an array', ['a', 'b']],
        ['a string', 'gap-8'],
        ['a number', 42],
    ])('rejects %s', (_label, value) => {
        expect(isValidMangleMap(value)).toBe(false);
    });

    it('rejects a non-string value', () => {
        expect(isValidMangleMap({ 'gap-8': 7 })).toBe(false);
    });

    it.each(['__proto__', 'constructor', 'prototype'])(
        'rejects the prototype-pollution key %s',
        key => {
            // Build via defineProperty so the dangerous key is an own enumerable entry.
            const obj: Record<string, unknown> = {};
            Object.defineProperty(obj, key, { value: 'x', enumerable: true, configurable: true });
            expect(isValidMangleMap(obj)).toBe(false);
        },
    );
});

describe('CSR recovery toggle', () => {
    afterEach(() => {
        disableCSRRecovery();
    });

    it('is disabled until enabled', () => {
        disableCSRRecovery();
        expect(isCSRRecoveryAllowed()).toBe(false);
    });

    it('reports allowed once enabled', () => {
        enableCSRRecovery();
        expect(isCSRRecoveryAllowed()).toBe(true);
    });

    it('returns to disallowed after disabling', () => {
        enableCSRRecovery();
        disableCSRRecovery();
        expect(isCSRRecoveryAllowed()).toBe(false);
    });
});
