/**
 * Coverage for the Svelte adapter's public API: object-literal parsing, class
 * attribute merging, the preprocess entry, and the preprocessor / vite plugin
 * factories. The existing suite covers transformMarkup; this fills the rest.
 */
import { describe, expect, it } from 'vitest';

import {
    mergeClassAttributes,
    parseObjectLiteral,
    preprocess,
    preprocessor,
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

describe('mergeClassAttributes', () => {
    it('merges two class attributes on one element into one', () => {
        const out = mergeClassAttributes('<div class="a" class="b" />');
        expect(out).toContain('class="a b"');
        expect(out.match(/class="/g)).toHaveLength(1);
    });

    it('leaves a single class attribute untouched', () => {
        const input = '<div class="a" />';
        expect(mergeClassAttributes(input)).toBe(input);
    });

    it('ignores text that is not an element tag', () => {
        const input = 'plain text with class="x" not in a tag start';
        expect(mergeClassAttributes(input)).toBe(input);
    });
});

describe('preprocess', () => {
    it('returns the source unchanged when there is no sz attribute', () => {
        const source = '<div class="p-4">no sz here</div>';
        expect(preprocess(source)).toEqual({ code: source, map: undefined });
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
