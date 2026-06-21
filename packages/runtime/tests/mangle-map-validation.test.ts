import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    isValidMangleMap,
    loadMangleMapFromDOM,
} from '../src/hydration.js';

describe('isValidMangleMap', () => {
    it('accepts a plain string→string map', () => {
        expect(isValidMangleMap({ 'p-4': 'a', 'bg-red-500': 'b' })).toBe(true);
        expect(isValidMangleMap({})).toBe(true);
    });

    it('rejects non-string values and non-object input', () => {
        expect(isValidMangleMap({ 'p-4': 1 })).toBe(false);
        expect(isValidMangleMap({ 'p-4': { x: 1 } })).toBe(false);
        expect(isValidMangleMap(null)).toBe(false);
        expect(isValidMangleMap('nope')).toBe(false);
        expect(isValidMangleMap(['a', 'b'])).toBe(false);
    });

    it('rejects prototype-polluting keys', () => {
        expect(
            isValidMangleMap(JSON.parse('{"__proto__":"x"}')),
        ).toBe(false);
        expect(isValidMangleMap(JSON.parse('{"constructor":"x"}'))).toBe(false);
    });

    it('rejects an oversized map', () => {
        const big: Record<string, string> = {};
        for (let i = 0; i < 100_001; i++) big[`c${i}`] = 'x';
        expect(isValidMangleMap(big)).toBe(false);
    });
});

describe('loadMangleMapFromDOM', () => {
    const realDocument = globalThis.document;
    afterEach(() => {
        // @ts-expect-error — restoring the test global
        globalThis.document = realDocument;
        vi.restoreAllMocks();
    });

    function stubDocumentWith(content: string): void {
        // @ts-expect-error — minimal document stub for the loader path
        globalThis.document = {
            getElementById: (id: string) =>
                id === '__CSSZYX_MANGLE_MAP__' ? { textContent: content } : null,
        };
    }

    it('returns a valid map from the DOM script tag', () => {
        stubDocumentWith('{"p-4":"a"}');
        expect(loadMangleMapFromDOM()).toEqual({ 'p-4': 'a' });
    });

    it('rejects a malformed/hostile map instead of applying it', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        stubDocumentWith('{"p-4":{"nested":"obj"}}');
        expect(loadMangleMapFromDOM()).toBeNull();
        stubDocumentWith('{"__proto__":"x"}');
        expect(loadMangleMapFromDOM()).toBeNull();
        expect(({} as Record<string, unknown>).x).toBeUndefined();
        err.mockRestore();
    });
});
