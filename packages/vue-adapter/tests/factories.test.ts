/**
 * The public preprocess() and Vite plugin wrappers, plus transformTemplate's
 * value-extraction and failure branches — the parts beyond the happy path the
 * existing suite already covers.
 */
import { describe, expect, it, vi } from 'vitest';

import { mergeClassAttributes, preprocess, transformTemplate, vitePlugin } from '../src/index.js';

type TransformFn = (code: string, id: string) => { code: string } | null;
const runTransform = (code: string, id: string, options = {}): { code: string } | null =>
    (vitePlugin(options).transform as unknown as TransformFn)(code, id);

describe('preprocess()', () => {
    it('returns the source untouched when there is no <template>', () => {
        const result = preprocess('<script>const x = 1;</script>');
        expect(result.transformed).toBe(false);
        expect(result.count).toBe(0);
    });

    it('transforms sz props inside a template', () => {
        const result = preprocess('<template><div :sz="{ p: 4 }" /></template>');
        expect(result.transformed).toBe(true);
        expect(result.code).not.toContain(':sz=');
    });

    it('reports no transform when the template has no real sz attribute', () => {
        const result = preprocess('<template><div data-sz="x" /></template>');
        expect(result.transformed).toBe(false);
    });
});

describe('vitePlugin()', () => {
    it('ignores non-vue files', () => {
        expect(runTransform('x', 'component.ts')).toBeNull();
    });

    it('skips vue files without sz props', () => {
        expect(runTransform('<template><div /></template>', 'A.vue')).toBeNull();
    });

    it('transforms vue files that use sz', () => {
        expect(
            runTransform('<template><div :sz="{ p: 4 }" /></template>', 'A.vue')?.code,
        ).toContain('class');
    });

    it('returns null when nothing transforms', () => {
        expect(runTransform('<template><div data-sz="x" /></template>', 'A.vue')).toBeNull();
    });
});

describe('transformTemplate branches', () => {
    it('extracts numbers, negatives, booleans, strings, arrays and nested objects', () => {
        const result = transformTemplate(
            `<div :sz="{ p: 4, m: -2, on: true, name: 'x', list: [1, -3], nested: { q: 5 } }" />`,
        );
        expect(result.count).toBe(1);
        expect(result.code).not.toContain(':sz=');
    });

    it('leaves an unparseable sz object in place and warns under debug', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = transformTemplate('<div :sz="{ not valid js }" />', { debug: true });
        expect(result.code).toContain(':sz=');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('transformTemplate and extract edges', () => {
    it('ignores a non-object sz value (array)', () => {
        expect(transformTemplate('<div :sz="[1, 2]" />').count).toBe(0);
    });

    it('ignores an unterminated sz object', () => {
        expect(transformTemplate('<div :sz="{ p: 4 " />').count).toBe(0);
    });

    it('merges a transformed sz into an existing class attribute', () => {
        const result = transformTemplate('<div class="foo" :sz="{ p: 4 }" />');
        const merged = mergeClassAttributes(result.code);
        expect(merged).toContain('foo');
        expect(merged).toContain('p-4');
    });

    it('returns the source when the template tag is never closed', () => {
        const result = preprocess('<template><div :sz="{ p: 4 }" />');
        expect(result.transformed).toBe(false);
    });
});

describe('transformTemplate and merge specifics', () => {
    it('logs a successful transform under debug', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        transformTemplate('<div :sz="{ p: 4 }" />', { debug: true });
        expect(log).toHaveBeenCalled();
        log.mockRestore();
    });

    it('ignores an sz attribute whose value is not quoted', () => {
        expect(transformTemplate('<div :sz=nope />').count).toBe(0);
    });
});

describe('class merge via preprocess', () => {
    it('merges a static class from sz with an existing dynamic :class', () => {
        const result = preprocess('<template><div :class="dyn" :sz="{ p: 4 }" /></template>');
        expect(result.transformed).toBe(true);
        expect(result.code).toContain('dyn');
        expect(result.code).toContain('p-4');
    });
});
