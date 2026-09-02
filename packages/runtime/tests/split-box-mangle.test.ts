/**
 * The class toolkit under a production mangle map.
 *
 * `has`, `classify`, `pick`, `omit` and `splitBox` read class names to answer
 * questions about them. On a mangled build the DOM carries `y`, not `w-full`,
 * and every answer silently flipped: `has('y', 'w')` was false, `splitBox`
 * routed every token to the fallback bucket, and a component that withheld a
 * default width only when the caller set one stopped withholding it in
 * production while staying correct in development. `szcn` already decoded
 * through the same registry; the toolkit did not, while its documentation
 * said it did.
 *
 * The contract pinned here: classify by the ORIGINAL name, answer with the
 * RAW token. `pick`/`omit`/`splitBox` never emit a decoded name, because the
 * stylesheet is mangled and only the raw token matches a rule.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearMangleRegistry, installMangleRuntime } from '../src/mangle-registry.js';
import { classify, has, omit, pick, splitBox } from '../src/split-box.js';

/** A build where every class the tests use was mangled. */
const MAP = {
    'w-full': 'a',
    'h-10': 'b',
    'px-2': 'c',
    'mt-4': 'd',
    'overflow-hidden': 'e',
    'md:w-1/2': 'f',
    'size-8': 'g',
} as const;

type Global = typeof globalThis & { __csszyx?: unknown };

beforeEach(() => {
    clearMangleRegistry();
    (globalThis as Global).__csszyx = undefined;
});

afterEach(() => {
    clearMangleRegistry();
    (globalThis as Global).__csszyx = undefined;
});

describe('with a mangle registry installed', () => {
    beforeEach(() => {
        installMangleRuntime({ mangleMap: MAP, checksum: 'one' });
    });

    it('classifies a mangled token by its original name', () => {
        expect(classify('a')).toEqual({ role: 'outer', category: 'sizing' });
        expect(classify('c')).toEqual({ role: 'inner', category: 'padding' });
        expect(classify('f')).toEqual({ role: 'outer', category: 'sizing' });
    });

    it('answers has() for a mangled token the way it does for the original', () => {
        expect(has('a', 'w')).toBe(true);
        expect(has('a', 'sizing')).toBe(true);
        expect(has('c', 'padding')).toBe(true);
        expect(has('e', { overflow: 'hidden' })).toBe(true);
        expect(has('a', 'padding')).toBe(false);
    });

    it('pick and omit keep the raw tokens, in order', () => {
        expect(pick('a c d', 'outer')).toBe('a d');
        expect(omit('a c d', 'outer')).toBe('c');
        // Never the decoded spelling: the stylesheet only has `.a`.
        expect(pick('a', 'w')).toBe('a');
    });

    it('splitBox routes mangled tokens to the right bucket and emits them raw', () => {
        expect(splitBox('d c a e')).toEqual({ outer: 'd a', inner: 'c e' });
    });

    it('handles a list mixing raw and mangled tokens', () => {
        // An authored literal survives mangling as itself; both spellings are
        // one class to the toolkit.
        expect(splitBox('mt-4 c w-full e')).toEqual({ outer: 'mt-4 w-full', inner: 'c e' });
        expect(has('mt-4 c', 'padding')).toBe(true);
    });

    it('leaves a token the map does not know as unowned', () => {
        expect(classify('zz')).toBeUndefined();
        expect(has('zz', 'w')).toBe(false);
        expect(splitBox('zz a')).toEqual({ outer: 'zz a', inner: '' });
    });
});

describe('registry lifecycle', () => {
    it('answers correctly once a registry arrives after the first call', () => {
        // The bundled registration module can run after a component's first
        // render; a memo filled under "no map" must not be served afterwards.
        expect(has('a', 'w')).toBe(false);
        expect(splitBox('a c')).toEqual({ outer: 'a c', inner: '' });

        installMangleRuntime({ mangleMap: MAP, checksum: 'late' });

        expect(has('a', 'w')).toBe(true);
        expect(classify('a')).toEqual({ role: 'outer', category: 'sizing' });
        expect(splitBox('a c')).toEqual({ outer: 'a', inner: 'c' });
    });

    it('forgets a replaced registry', () => {
        installMangleRuntime({ mangleMap: MAP, checksum: 'first' });
        expect(has('a', 'w')).toBe(true);

        // A different build's map: `a` now means padding.
        installMangleRuntime({ mangleMap: { 'px-2': 'a', 'w-full': 'q' }, checksum: 'second' });

        expect(has('a', 'w')).toBe(false);
        expect(has('a', 'padding')).toBe(true);
        expect(splitBox('a q')).toEqual({ outer: 'q', inner: 'a' });
    });

    it('is identity again after the registry is cleared', () => {
        installMangleRuntime({ mangleMap: MAP, checksum: 'gone' });
        expect(has('a', 'w')).toBe(true);
        clearMangleRegistry();
        expect(has('a', 'w')).toBe(false);
        expect(has('w-full', 'w')).toBe(true);
    });

    it('reads the legacy inline-script bridge the way szcn does', () => {
        const legacy: Record<string, string> = { a: 'w-full', c: 'px-2' };
        (globalThis as Global).__csszyx = {
            decode: (token: string) => legacy[token],
        };
        expect(has('a', 'w')).toBe(true);
        expect(splitBox('a c')).toEqual({ outer: 'a', inner: 'c' });
    });
});

describe('a hostile or broken decoder', () => {
    it('falls back to the raw token when decode throws', () => {
        (globalThis as Global).__csszyx = {
            decode: () => {
                throw new Error('map mid-update');
            },
        };
        expect(() => splitBox('w-full px-2')).not.toThrow();
        expect(splitBox('w-full px-2')).toEqual({ outer: 'w-full', inner: 'px-2' });
        expect(has('a', 'w')).toBe(false);
    });

    it('falls back to the raw token when decode answers a non-string', () => {
        (globalThis as Global).__csszyx = {
            decode: () => 42 as unknown as string,
        };
        expect(has('w-full', 'w')).toBe(true);
        expect(classify('a')).toBeUndefined();
    });
});
