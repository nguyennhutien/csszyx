/**
 * Objects lowered at runtime carry the project's Tailwind prefix.
 *
 * A spread or a value only known when the component renders keeps the sz
 * object for the runtime: `sz={{ p: 4, ...rest }}` compiles to
 * `_sz({ p: 4, ...rest })`. Under `@import "tailwindcss" prefix(tw)` the project
 * serves `tw:p-4` and nothing for `p-4`, so the runtime has to write the prefix
 * the build registered, exactly where the compiler writes it: before every
 * class an object lowers to, variants after it. A class string an author wrote
 * is left alone — it names classes in the project's own vocabulary already.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { _sz, _szMerge, registerSzClassPrefix, setSzClassPrefix, szr } from '../src/index.js';

interface PrefixGlobals {
    __csszyx_class_prefix?: string;
    __csszyx_class_prefix_registration?: { readonly value: string | null };
    __csszyx_ssr_mangle_map?: Record<string, string>;
}

const globals = globalThis as typeof globalThis & PrefixGlobals;

afterEach(() => {
    setSzClassPrefix(null);
    delete globals.__csszyx_class_prefix;
    delete globals.__csszyx_class_prefix_registration;
    delete globals.__csszyx_ssr_mangle_map;
});

describe('setSzClassPrefix', () => {
    it('fails loudly instead of switching a shared realm to another build prefix', () => {
        registerSzClassPrefix('tw');

        expect(() => registerSzClassPrefix('ui')).toThrowError(
            /registered different Tailwind prefixes: prefix\(tw\) and prefix\(ui\)/,
        );
        expect(_sz({ p: 4 })).toBe('tw:p-4');
    });

    it('treats no prefix as an explicit registration that can conflict', () => {
        registerSzClassPrefix(null);

        expect(() => registerSzClassPrefix('tw')).toThrowError(
            /registered different Tailwind prefixes: no prefix and prefix\(tw\)/,
        );
        expect(_sz({ p: 4 })).toBe('p-4');
    });

    it('normalizes an empty registered prefix to no prefix', () => {
        registerSzClassPrefix('');

        expect(_sz({ p: 4 })).toBe('p-4');
        expect(() => registerSzClassPrefix('tw')).toThrowError(
            /registered different Tailwind prefixes: no prefix and prefix\(tw\)/,
        );
    });

    it('allows every module from one build to register the same prefix', () => {
        registerSzClassPrefix('tw');
        registerSzClassPrefix('tw');

        expect(_sz({ p: 4 })).toBe('tw:p-4');
    });

    it('rejects a prefix registered by another runtime copy through the global slot', () => {
        globals.__csszyx_class_prefix = 'tw';
        globals.__csszyx_class_prefix_registration = { value: 'tw' };

        expect(() => registerSzClassPrefix('ui')).toThrowError(
            /registered different Tailwind prefixes: prefix\(tw\) and prefix\(ui\)/,
        );
        expect(globals.__csszyx_class_prefix).toBe('tw');
    });

    it('rejects an unprefixed build after a prefixed build registered globally', () => {
        globals.__csszyx_class_prefix = 'tw';
        globals.__csszyx_class_prefix_registration = { value: 'tw' };

        expect(() => registerSzClassPrefix(null)).toThrowError(
            /registered different Tailwind prefixes: prefix\(tw\) and no prefix/,
        );
        expect(globals.__csszyx_class_prefix).toBe('tw');
    });

    it('writes the prefix before every class an object lowers to', () => {
        setSzClassPrefix('tw');

        expect(_sz({ p: 4 })).toBe('tw:p-4');
    });

    it('keeps variants after the prefix, the order Tailwind serves', () => {
        const unprefixed = _sz({ p: 4, hover: { bg: 'red-500' }, md: { m: -2 } });
        setSzClassPrefix('tw');

        expect(_sz({ p: 4, hover: { bg: 'red-500' }, md: { m: -2 } })).toBe(
            unprefixed
                .split(' ')
                .map(name => `tw:${name}`)
                .join(' '),
        );
        expect(_sz({ hover: { bg: 'red-500' } })).toMatch(/^tw:hover:/);
    });

    it('leaves a class string an author wrote alone', () => {
        setSzClassPrefix('tw');

        expect(_sz('card', { p: 4 }, 'tw:m-2')).toBe('card tw:p-4 tw:m-2');
    });

    it('prefixes a run of adjacent objects once, after they merge', () => {
        setSzClassPrefix('tw');

        expect(_sz([{ p: 4 }, { m: 2 }])).toBe('tw:p-4 tw:m-2');
    });

    it('reaches every helper that lowers an object', () => {
        setSzClassPrefix('tw');

        expect(_szMerge({ p: 4 }, { p: 8 })).toBe('tw:p-8');
        expect(szr({ p: 4 })).toContain('tw:p-4');
    });

    it('looks up the mangled name of the prefixed class', () => {
        globals.__csszyx_ssr_mangle_map = { 'tw:p-4': 'a' };
        setSzClassPrefix('tw');

        expect(_sz({ p: 4 })).toBe('a');
    });

    it('lowers as before once the prefix is cleared, or set to nothing', () => {
        setSzClassPrefix('tw');
        setSzClassPrefix(null);
        expect(_sz({ p: 4 })).toBe('p-4');

        setSzClassPrefix('');
        expect(_sz({ p: 4 })).toBe('p-4');
    });

    it('is read from another copy of the runtime through the global slot', () => {
        // Two copies of the package in one bundle each keep their own module
        // state; the registration one of them ran has to reach the other.
        globals.__csszyx_class_prefix = 'tw';

        expect(_sz({ p: 4 })).toBe('tw:p-4');
    });

    it('leaves an object that lowers to nothing empty', () => {
        setSzClassPrefix('tw');

        expect(_sz({})).toBe('');
    });
});
