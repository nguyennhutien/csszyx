import { describe, expect, it } from 'vitest';

import { szr } from '../src/concatenate.js';
import { _sz as liteSz, _szMerge as liteSzMerge } from '../src/lite.js';
import { splitBoxSz } from '../src/split-box.js';

/**
 * The sz-type bridge widened `SzInput`'s object member to `object` so a precise
 * `SzProps`/`SzPropValue` (the JSX-augmentation type) forwards into the runtime
 * helpers without a cast. The change is type-only; these tests lock that the
 * RUNTIME behavior is unchanged for every input shape — especially the wrapper
 * forwarding scenario the bridge exists for — and that the lite (string-only) path
 * still rejects objects.
 */
describe('sz-input bridge — forwarding precise sz objects through the runtime', () => {
    it('resolves a forwarded sz object to a className (the wrapper scenario)', () => {
        // Simulates a polymorphic wrapper: typed `sz` flows straight into szr.
        const forward = (sz: object | string): string => szr(sz);
        expect(forward({ p: 4 })).toBe('p-4');
        expect(forward({ p: 4, m: 2 })).toContain('p-4');
        expect(forward('already-a-string')).toBe('already-a-string');
    });

    it('handles variant keys in a forwarded object', () => {
        const out = szr({ p: 4, hover: { bg: 'red-500' } });
        expect(out).toContain('p-4');
        expect(out).toContain('hover:bg-red-500');
    });

    it('mixes forwarded objects, strings, and falsy conditionals', () => {
        const active = false;
        const out = szr({ p: 4 }, active && { bg: 'red-500' }, 'extra', null, undefined);
        expect(out).toContain('p-4');
        expect(out).toContain('extra');
        expect(out).not.toContain('bg-red-500'); // active is false → skipped
    });

    it('resolves a nested array of forwarded objects', () => {
        const out = szr([{ p: 4 }, [{ m: 2 }, 'gap-2']]);
        expect(out).toContain('p-4');
        expect(out).toContain('m-2');
        expect(out).toContain('gap-2');
    });

    it('returns empty string for all-falsy / empty input', () => {
        expect(szr()).toBe('');
        expect(szr(null, undefined, false)).toBe('');
        expect(szr({})).toBe('');
    });

    it('throws on object nesting past the depth bound (untrusted-data guard)', () => {
        // Build an array nested deeper than MAX_SZ_DEPTH.
        let nested: unknown = { p: 4 };
        for (let i = 0; i < 60; i++) {
            nested = [nested];
        }
        expect(() => szr(nested as object)).toThrow();
    });

    it('partitions a forwarded sz object via splitBoxSz', () => {
        const result = splitBoxSz({ p: 4, gap: 2 });
        // splitBoxSz returns outer/inner partitions; both keys must survive somewhere.
        const combined = JSON.stringify(result);
        expect(combined).toContain('p');
        expect(combined).toContain('gap');
    });
});

describe('lite (string-only) path still rejects objects after the rename', () => {
    it('concatenates pre-compiled strings', () => {
        expect(liteSz('p-4', 'bg-red-500')).toBe('p-4 bg-red-500');
        expect(liteSz('base', false, null, 'active')).toBe('base active');
    });

    it('deduplicates in the lite merge', () => {
        expect(liteSzMerge('p-4 gap-2', 'gap-2 m-1')).toBe('p-4 gap-2 m-1');
    });

    it('throws in dev when an object reaches the string-only lite helper', () => {
        // The lite path has no compiler; an object here is a compiler-fallback bug.
        expect(() => liteSz({ p: 4 } as unknown as string)).toThrow(/plain object/);
    });
});
