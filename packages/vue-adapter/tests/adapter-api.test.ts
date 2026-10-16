/**
 * Coverage for the Vue adapter's public API: template extraction, the
 * preprocess entry, and the vite plugin factory. The existing
 * suite covers transformTemplate; this fills the rest.
 */
import { describe, expect, it } from 'vitest';

import { extractTemplate, preprocess, transformTemplate, vitePlugin } from '../src/index.js';

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
        expect(transformTemplate(source)).toEqual({
            code: source,
            count: 0,
            transformed: false,
            diagnostics: [],
            map: null,
        });
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
