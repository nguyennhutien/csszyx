/**
 * The two public integration factories: the Svelte preprocessor group and the
 * Vite plugin. Their internal transform is covered elsewhere; this pins the
 * wrapper branches — skip, transform, no-match, file-type, and debug.
 */
import { describe, expect, it, vi } from 'vitest';

import { preprocessor, vitePlugin } from '../src/index.js';

type MarkupResult = { code: string } | undefined;
const runMarkup = (content: string, options = {}, filename?: string): MarkupResult =>
    preprocessor(options).markup?.({ content, filename }) as MarkupResult;

type TransformFn = (code: string, id: string) => { code: string } | null;
const runTransform = (code: string, id: string, options = {}): { code: string } | null =>
    (vitePlugin(options).transform as unknown as TransformFn)(code, id);

describe('preprocessor()', () => {
    it('skips content with no sz attribute', () => {
        expect(runMarkup('<div class="p-4" />')).toBeUndefined();
    });

    it('transforms sz props into a class attribute', () => {
        const result = runMarkup('<div sz={{ p: 4 }} />', {}, 'A.svelte');
        expect(result?.code).toContain('class');
        expect(result?.code).not.toContain('sz={{');
    });

    it('returns undefined when the sz= substring is not a real attribute', () => {
        expect(runMarkup('<div data-sz="x" />')).toBeUndefined();
    });

    it('logs when debug is enabled', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        runMarkup('<div sz={{ p: 4 }} />', { debug: true }, 'A.svelte');
        expect(log).toHaveBeenCalled();
        log.mockRestore();
    });
});

describe('vitePlugin()', () => {
    it('ignores non-svelte files', () => {
        expect(runTransform('whatever', 'component.ts')).toBeNull();
    });

    it('skips svelte files without sz props', () => {
        expect(runTransform('<div />', 'A.svelte')).toBeNull();
    });

    it('transforms svelte files that use sz', () => {
        expect(runTransform('<div sz={{ p: 4 }} />', 'A.svelte')?.code).toContain('class');
    });

    it('returns null when no sz attribute matches', () => {
        expect(runTransform('<div data-sz="x" />', 'A.svelte')).toBeNull();
    });
});
