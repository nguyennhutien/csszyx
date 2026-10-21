/**
 * The adapter finds `sz` where Vue's own parser finds an attribute, and only
 * there. A text scan read `sz=` in page text, in an interpolation, in a
 * comment and under `v-pre`, missed `sz = "…"`, and wrote a second `class`
 * beside a static one; each of those either changed the page or stopped
 * Vue's compiler.
 */
import { describe, expect, it } from 'vitest';

import { preprocess, transformTemplate, vitePlugin } from '../src/index.js';

const PARSERS = ['rust', 'wasm'] as const;

/**
 * Wrap a template body in an SFC.
 * @param body - The template body.
 * @returns The SFC source.
 */
function sfc(body: string): string {
    return `<template>${body}</template>\n`;
}

describe.each(PARSERS)('the %s artifact', parser => {
    const run = (source: string) => preprocess(source, { filename: 'App.vue', parser });

    it.each([
        ['page text', '<p>write sz="{ p: 4 }" here</p>'],
        ['an interpolation', `<p>{{ " sz='{ p: 4 }'" }}</p>`],
        ['a comment', '<!-- <div sz="{ p: 4 }"> -->'],
        ['a v-pre subtree', '<div v-pre><p sz="{ p: 4 }" :sz="{ m: 1 }"></p></div>'],
    ])('leaves sz= in %s as written', (_name, body) => {
        const source = sfc(body);
        expect(run(source)).toMatchObject({ code: source, count: 0, diagnostics: [] });
    });

    it('lowers an attribute written with spaces around its equals sign', () => {
        expect(run(sfc('<div sz = "{ p: 4 }"></div>')).code).toBe(sfc('<div class="p-4"></div>'));
    });

    it.each([
        ['after it', '<div class="a" :sz="{ p: 4 }"></div>', '<div class="a p-4"></div>'],
        ['before it', '<div :sz="{ p: 4 }" class="a"></div>', '<div class="a p-4"></div>'],
        [
            'beside a bound class and a quoted greater-than',
            '<div :title="a > b" :sz="{ p: 4 }" class="x" :class="y"></div>',
            '<div :title="a > b" class="x p-4" :class="y"></div>',
        ],
        ['empty', '<div class="" sz="{ p: 4 }"></div>', '<div class="p-4"></div>'],
    ])('adds the class to a static class attribute %s', (_name, body, expected) => {
        expect(run(sfc(body)).code).toBe(sfc(expected));
    });

    it('writes its own class beside a bound one, which Vue joins', () => {
        expect(run(sfc('<div :class="y" :sz="{ p: 4 }"></div>')).code).toBe(
            sfc('<div :class="y" class="p-4"></div>'),
        );
    });

    it('reads only the root template, whatever precedes it', () => {
        const source = `<docs>${'İ'.repeat(40)}<b :sz="{ m: 1 }"></b></docs>\n${sfc('<i :sz="{ m: 2 }"></i>')}`;
        expect(run(source).code).toBe(
            `<docs>${'İ'.repeat(40)}<b :sz="{ m: 1 }"></b></docs>\n${sfc('<i class="m-2"></i>')}`,
        );
    });

    it('reports a template in another language instead of skipping it', () => {
        const source = '<template lang="pug">\ndiv(sz="{ p: 4 }")\n</template>\n';
        const result = run(source);
        expect(result.code).toBe(source);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]).toMatchObject({
            severity: 'error',
            code: 'template-lang-unsupported',
            args: { lang: 'pug' },
            line: 1,
            column: 1,
        });
        expect(result.diagnostics[0].message).toBe(
            '[csszyx] template-lang-unsupported: App.vue:1:1\n' +
                '  This template is `<template lang="pug">`, and csszyx reads `sz` in HTML templates only, so no `sz` attribute in it gets a class.\n' +
                '  help: write the template in HTML, or bind `class` yourself in it.\n' +
                '  docs: https://csszyx.com/e/template-lang-unsupported',
        );
    });

    it('reports a template Vue cannot parse instead of skipping it', () => {
        const source = sfc('<div sz="{ p: 4 }"><p></div>');
        const result = run(source);
        expect(result.code).toBe(source);
        expect(result.diagnostics).toHaveLength(1);
        const [diagnostic] = result.diagnostics;
        expect(diagnostic).toMatchObject({
            severity: 'error',
            code: 'template-unparsable',
            args: { form: 'vue', message: expect.any(String) },
        });
        const { message } = diagnostic.args as { message: string };
        expect(diagnostic.message).toBe(
            `[csszyx] template-unparsable: App.vue:${diagnostic.line}:${diagnostic.column}\n` +
                '  Vue cannot parse this file, so no `sz` attribute in it gets a class.\n' +
                '  help: fix the error the Vue compiler reports; the file does not compile without csszyx either.\n' +
                `  note: the Vue compiler reported: ${message.replace(/\.$/, '')}.\n` +
                '  docs: https://csszyx.com/e/template-unparsable',
        );
    });
});

describe('the Vite plugin', () => {
    it('returns a source map for the code it changed', () => {
        const plugin = vitePlugin({ parser: 'wasm' }) as unknown as {
            transform: (this: unknown, code: string, id: string) => { map: unknown } | null;
        };
        const context = {
            warn: () => {},
            error: (error: Error) => {
                throw error;
            },
        };
        const result = plugin.transform.call(context, sfc('<div sz="{ p: 4 }"></div>'), '/a.vue');
        expect(result?.map).toMatchObject({ version: 3, sources: ['/a.vue'] });
    });
});

describe('reading edges', () => {
    it('quotes an unquoted class value it joins', () => {
        expect(preprocess(sfc('<div class=a :sz="{ p: 4 }"></div>'), { parser: 'wasm' }).code).toBe(
            sfc('<div class="a p-4"></div>'),
        );
    });

    it('reads nothing from a template kept in another file', () => {
        const source = '<template src="./x.html"></template>\n<script>const sz = 1;</script>\n';
        expect(preprocess(source)).toMatchObject({ code: source, count: 0, diagnostics: [] });
    });

    it('places a parse error in a bare template', () => {
        const result = transformTemplate('<div sz="{ p: 4 }"><p></div>');
        expect(result.diagnostics.map(d => [d.severity, d.line])).toEqual([['error', 1]]);
        expect(result.diagnostics[0].message).toContain(
            'Vue cannot parse this file, so no `sz` attribute in it gets a class.',
        );
    });
});
