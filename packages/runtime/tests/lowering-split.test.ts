/**
 * Contract of the runtime split: string helpers without the compiler.
 *
 * `import { szr }` used to ship the ~12.6 KB gz browser transform because the
 * object branch referenced it statically. The split moves that reference
 * behind a registration slot: `@csszyx/runtime/core` helpers are string-first,
 * `@csszyx/runtime/lowering` (a bare side-effect import) makes them
 * object-capable, and the back-compat `@csszyx/runtime` entry registers
 * eagerly on first call so `szr({ p: 4 })` standalone behaves exactly as it
 * always has.
 *
 * The failure mode this file pins hardest: an object arriving with no lowerer
 * must THROW with the one-line fix — never return '' and silently unstyle the
 * page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    _sz as barrelSz,
    _szMerge as barrelSzMerge,
    _szPart as barrelSzPart,
    szr as barrelSzr,
} from '../src/concatenate.js';
import { _sz, _sz2, _sz3, szr } from '../src/core.js';
import { lowerSz, registerSzLowering } from '../src/lowering.js';
import { getSzLowering, setSzLowering } from '../src/lowering-slot.js';
import { _szMerge, _szPart } from '../src/merge.js';

/** globalThis carriers the assertions poke: fallback slot + mangle map. */
interface SzLoweringGlobals {
    __csszyx_lowering?: (szProp: object) => string;
    __csszyx_ssr_mangle_map?: Readonly<Record<string, string>>;
}

afterEach(() => {
    setSzLowering(null);
    (globalThis as SzLoweringGlobals).__csszyx_ssr_mangle_map = undefined;
});

describe('core string paths (no lowering registered)', () => {
    it('passes a single compiled string through untouched', () => {
        expect(_sz('p-4 bg-red-500')).toBe('p-4 bg-red-500');
    });

    it('concatenates strings and skips falsy guards', () => {
        expect(_sz('base', false, 'active', null, undefined, '')).toBe('base active');
    });

    it('flattens nested arrays of strings', () => {
        expect(_sz(['a', ['b', ['c']]])).toBe('a b c');
    });

    it('keeps the fixed-arity fast paths working', () => {
        expect(_sz2('a', 'b')).toBe('a b');
        expect(_sz2('', 'b')).toBe('b');
        expect(_sz3('a', '', 'c')).toBe('a c');
    });

    it('_szPart passes strings through without needing a lowerer', () => {
        expect(_szPart('text-lg')).toBe('text-lg');
    });

    it('szr is _sz', () => {
        // The alias is identity, not a copy — call sites and tests may compare.
        expect(szr).toBe(_sz);
    });
});

describe('core object paths without a lowerer', () => {
    it('throws loudly instead of silently dropping styling', () => {
        expect(() => _sz({ p: 4 })).toThrowError(/object-lowering/);
    });

    it('names the one-line fix in the error', () => {
        expect(() => szr({ p: 4 })).toThrowError(/@csszyx\/runtime\/lowering/);
    });

    it('throws for an object nested inside an array too', () => {
        expect(() => _sz(['a', { p: 4 }])).toThrowError(/object-lowering/);
    });

    it('throws from _szPart and _szMerge as well', () => {
        expect(() => _szPart({ p: 4 })).toThrowError(/object-lowering/);
        expect(() => _szMerge({ p: 4 })).toThrowError(/object-lowering/);
    });
});

describe('registration', () => {
    it('registerSzLowering makes core helpers object-capable', () => {
        registerSzLowering();
        expect(szr({ p: 4, bg: 'red-500' })).toBe('p-4 bg-red-500');
        expect(_szPart({ p: 4 })).toBe('p-4');
    });

    it('the registered lowerer applies an active mangle map', () => {
        registerSzLowering();
        (globalThis as SzLoweringGlobals).__csszyx_ssr_mangle_map = { 'p-4': 'z' };
        expect(szr({ p: 4 })).toBe('z');
    });

    it('mixes lowered objects with strings in one call', () => {
        registerSzLowering();
        expect(szr('base', { p: 4 }, false, 'extra')).toBe('base p-4 extra');
    });

    it('is idempotent', () => {
        registerSzLowering();
        registerSzLowering();
        expect(getSzLowering()).toBe(lowerSz);
    });
});

describe('cross-instance fallback (ESM/CJS split)', () => {
    it('reads a lowerer registered by another package instance via globalThis', () => {
        // Simulate the other-format instance: local slot empty, global set.
        setSzLowering(null);
        (globalThis as SzLoweringGlobals).__csszyx_lowering = () => 'from-other-instance';
        expect(_sz({ p: 4 })).toBe('from-other-instance');
        delete (globalThis as SzLoweringGlobals).__csszyx_lowering;
    });

    it('prefers the local registration over the global fallback', () => {
        // Two package VERSIONS in one app must keep their own lowerers.
        (globalThis as SzLoweringGlobals).__csszyx_lowering = () => 'global';
        setSzLowering(() => 'local');
        expect(_sz({ p: 4 })).toBe('local');
        delete (globalThis as SzLoweringGlobals).__csszyx_lowering;
    });
});

describe('back-compat @csszyx/runtime entry', () => {
    it('szr({...}) works standalone with no registration and no plugin', () => {
        // THE historical contract. Slot deliberately empty before the call.
        expect(getSzLowering()).toBeNull();
        expect(barrelSzr({ p: 4, bg: 'red-500' })).toBe('p-4 bg-red-500');
    });

    it('_sz, _szMerge and _szPart self-register the same way', () => {
        setSzLowering(null);
        expect(barrelSz({ m: 2 })).toBe('m-2');
        setSzLowering(null);
        expect(barrelSzMerge({ p: 4 }, { p: 2 })).toBe('p-2');
        setSzLowering(null);
        expect(barrelSzPart({ p: 4 })).toBe('p-4');
    });

    it('does not overwrite an existing registration', () => {
        const custom = (): string => 'custom';
        setSzLowering(custom);
        barrelSzr('strings-only');
        expect(getSzLowering()).toBe(custom);
    });

    it('barrel szr is barrel _sz', () => {
        expect(barrelSzr).toBe(barrelSz);
    });
});
