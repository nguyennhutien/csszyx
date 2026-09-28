/**
 * Coverage for the Svelte adapter's public API: object-literal parsing, class
 * attribute merging, the preprocess entry, and the preprocessor / vite plugin
 * factories. The existing suite covers transformMarkup; this fills the rest.
 */
import { compile } from 'svelte/compiler';
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

    it('merges only the class attributes on one side of a spread', () => {
        expect(mergeClassAttributes('<div class="a" class="b" {...rest} class="c"></div>')).toBe(
            '<div class="a b"  {...rest} class="c"></div>',
        );
        expect(mergeClassAttributes('<div {...rest} class="a" class="b"></div>')).toBe(
            '<div {...rest} class="a b" ></div>',
        );
    });

    it.each([
        ['an action', '<div class="a" use:tip={{...o, x: 1}} class="b"></div>'],
        ['a call', '<div class="a" data-j={JSON.stringify({...o})} class="b"></div>'],
        ['a spaced action', '<div class="a" use:tip={ {...{ x: 1 }} } class="b"></div>'],
        ['a spaced value', '<div class="a" data-x={ {...rest} } class="b"></div>'],
        ['a quoted value', '<div class="a" title="see { {...x} }" class="b"></div>'],
        ['a brace in a string', '<div class="a" data-x={ f(`}`, {...o}) } class="b"></div>'],
    ])('does not take an object spread inside %s for a spread attribute', (_name, tag) => {
        const out = mergeClassAttributes(tag);
        expect(out).toContain('class="a b"');
        expect(out.match(/class="/g)).toHaveLength(1);
    });

    it('takes a spread whose object holds braces as one spread', () => {
        expect(
            mergeClassAttributes('<div class="a" {...{ x: { y: 1 } }} class="b" class="c"></div>'),
        ).toBe('<div class="a" {...{ x: { y: 1 } }} class="b c" ></div>');
    });

    it('reads a spread the tag scan cut short as part of its side', () => {
        // The scan ends a tag at its first `>`, so a spread holding one is cut
        // before its `}` and stays in the side it began on.
        expect(mergeClassAttributes('<div class="a" class="b" {...(x > y ? p : q)} />')).toBe(
            '<div class="a b"  {...(x > y ? p : q)} />',
        );
    });

    it('reads a quoted value the tag scan cut short as part of its side', () => {
        expect(mergeClassAttributes('<div {...r} class="a" class="b" title="x > y" />')).toBe(
            '<div {...r} class="a b"  title="x > y" />',
        );
    });

    it('leaves class attributes on either side of a spread for Svelte to refuse', () => {
        const input = '<div class="card" {...rest} class="p-4"></div>';
        expect(mergeClassAttributes(input)).toBe(input);
        // Svelte stops the build here with its own message, naming the element.
        expect(() => compile(input, { generate: 'server' })).toThrow(
            /Attributes need to be unique/,
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
