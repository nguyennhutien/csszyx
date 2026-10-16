/**
 * Coverage for the Svelte adapter's public API: the class an sz joins, the
 * preprocess entry, and the preprocessor / vite plugin factories. The
 * existing suite covers transformMarkup; this fills the rest.
 */
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

import { preprocess, preprocessor, vitePlugin } from '../src/index.js';

describe('the class an sz joins', () => {
    it.each([
        ['after it', '<div class="a" sz={{ p: 4 }}></div>', '<div class="a p-4"></div>'],
        ['before it', '<div sz={{ p: 4 }} class="a"></div>', '<div class="a p-4"></div>'],
        [
            'on its side of a spread',
            '<div {...rest} class="a" sz={{ p: 4 }}></div>',
            '<div {...rest} class="a p-4"></div>',
        ],
        [
            'whose value holds a spread-like brace',
            `<div class="{x ? '{...a}' : 'b'}" sz={{ p: 4 }}></div>`,
            `<div class="{x ? '{...a}' : 'b'} p-4"></div>`,
        ],
        ['empty', '<div class="" sz={{ p: 4 }}></div>', '<div class="p-4"></div>'],
    ])('is the quoted class %s', (_name, source, expected) => {
        expect(preprocess(source).code).toBe(expected);
    });

    it('is none for a class written as one expression', () => {
        // A class string cannot join `class={…}`; Svelte names the duplicate.
        expect(preprocess('<div class={c} sz={{ p: 4 }}></div>').code).toBe(
            '<div class={c} class="p-4"></div>',
        );
    });

    it('hands Svelte the two class attributes an sz after a spread makes', () => {
        const source =
            '<script>let { ...rest } = $props();</script>\n<div class="card" {...rest} sz={{ p: 4 }}></div>';
        const out = preprocess(source).code;
        expect(out).toContain('class="card" {...rest}');
        expect(out).toContain('class="p-4"');
        expect(() => compile(out, { generate: 'server' })).toThrow(/Attributes need to be unique/);
    });
});

describe('preprocess', () => {
    it('returns the source unchanged when there is no sz attribute', () => {
        const source = '<div class="p-4">no sz here</div>';
        expect(preprocess(source)).toEqual({ code: source, map: null, diagnostics: [] });
    });

    it('transforms an sz attribute into classes', () => {
        const result = preprocess('<div sz={{ p: 4 }} />');
        expect(result.code).toContain('p-4');
        expect(result.code).not.toContain('sz={{');
    });
});

describe('preprocessor factory', () => {
    it('exposes a named markup hook', () => {
        const group = preprocessor();
        expect(group.name).toBe('csszyx-svelte');
        expect(typeof group.markup).toBe('function');
    });

    it('markup transforms sz content', () => {
        const group = preprocessor();
        const out = group.markup?.({ content: '<div sz={{ p: 4 }} />', filename: 'A.svelte' });
        expect(out && 'code' in out ? out.code : '').toContain('p-4');
    });
});

describe('vitePlugin factory', () => {
    it('returns a named vite plugin', () => {
        const plugin = vitePlugin();
        expect(plugin.name).toBe('csszyx-svelte-vite');
    });
});
