/**
 * Coverage for the Vue adapter's public API: object-literal parsing, template
 * extraction, class merging, the preprocess entry, and the vite plugin factory.
 * The existing suite covers transformTemplate; this fills the rest.
 */
import { describe, expect, it } from 'vitest';

import {
    extractTemplate,
    mergeClassAttributes,
    parseObjectLiteral,
    preprocess,
    transformTemplate,
    vitePlugin,
} from '../src/index.js';

describe('parseObjectLiteral', () => {
    it('parses a static object literal', () => {
        expect(parseObjectLiteral('{ p: 4 }')).toEqual({ p: 4 });
    });

    it('parses nested objects', () => {
        expect(parseObjectLiteral('{ hover: { bg: "red-500" } }')).toEqual({
            hover: { bg: 'red-500' },
        });
    });

    it('returns null for a non-object expression', () => {
        expect(parseObjectLiteral('42')).toBeNull();
    });

    it('returns null for a syntax error', () => {
        expect(parseObjectLiteral('{ p: }')).toBeNull();
    });
});

describe('extractTemplate', () => {
    it('extracts the template block content', () => {
        const info = extractTemplate('<template><div /></template>');
        expect(info?.content).toContain('<div />');
    });

    it('returns null when there is no template block', () => {
        expect(extractTemplate('<script>export default {}</script>')).toBeNull();
    });
});

describe('transformTemplate', () => {
    it('transforms a bound sz attribute into classes', () => {
        const result = transformTemplate('<div :sz="{ p: 4 }" />');
        expect(result.count).toBe(1);
        expect(result.code).toContain('p-4');
    });

    it('leaves a template without sz untouched', () => {
        const source = '<div class="p-4" />';
        expect(transformTemplate(source)).toEqual({ code: source, count: 0, transformed: false });
    });
});

describe('mergeClassAttributes', () => {
    it('leaves an element with only a static class untouched', () => {
        const input = '<div class="a" />';
        expect(mergeClassAttributes(input)).toBe(input);
    });

    it('returns non-element text unchanged', () => {
        const input = 'no tags here, just class="x" text';
        expect(mergeClassAttributes(input)).toBe(input);
    });
});

describe('preprocess', () => {
    it('returns count 0 when the source has no template', () => {
        const source = '<script>export default {}</script>';
        expect(preprocess(source).count).toBe(0);
    });

    it('transforms sz inside a single-file component template', () => {
        const result = preprocess('<template><div :sz="{ p: 4 }" /></template>');
        expect(result.count).toBe(1);
        expect(result.code).toContain('p-4');
    });
});

describe('vitePlugin factory', () => {
    it('returns a named vite plugin', () => {
        expect(vitePlugin().name).toBe('csszyx-vue');
    });
});
