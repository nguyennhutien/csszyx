/**
 * The adapter finds `sz` where Svelte's own parser finds an attribute, and
 * only there. A text scan lowered `sz` written in a comment, in an `@html`
 * string and in a `<script>` string past text whose lower case is longer, and
 * merged `class` into `input-class` or `data-class`, which corrupted the tag.
 */
import { describe, expect, it } from 'vitest';

import { preprocess, vitePlugin } from '../src/index.js';

const PARSERS = ['rust', 'wasm'] as const;

describe.each(PARSERS)('the %s artifact', parser => {
    const run = (source: string) => preprocess(source, { filename: 'App.svelte', parser });

    it.each([
        ['a comment', '<!-- <div sz={{ p: 4 }}> -->'],
        ['an {@html} string', `{@html '<div sz={{ p: 4 }}></div>'}`],
        ['page text', '<p>use sz={{ p: 4 }} like this</p>'],
    ])('leaves sz in %s as written', (_name, source) => {
        expect(run(source)).toMatchObject({ code: source, diagnostics: [] });
    });

    it('reads only the markup past text whose lower case is longer', () => {
        // One close tag per line: two read as a regex literal to the text-level
        // `check-tag-filter-regexes.mjs`.
        const text = `<p>${'İ'.repeat(40)}</p>`;
        const head = `${text}<script>const a = '<a sz={{ p: 1 }}>';</script>`;
        expect(run(`${head}<div sz={{ p: 4 }}></div>`).code).toBe(`${head}<div class="p-4"></div>`);
    });

    it.each([
        [
            'an input-class prop',
            '<Input input-class="x" class="p-1" sz={{ p: 4 }} />',
            '<Input input-class="x" class="p-1 p-4" />',
        ],
        [
            'a data-class attribute',
            '<Input class="p-1" data-class="z" sz={{ p: 4 }} />',
            '<Input class="p-1 p-4" data-class="z" />',
        ],
        [
            'a class holding an expression',
            '<div class="a {b}" sz={{ p: 4 }}></div>',
            '<div class="a {b} p-4"></div>',
        ],
    ])('adds the class to the real class attribute beside %s', (_name, source, expected) => {
        expect(run(source).code).toBe(expected);
    });

    it('lowers past a byte order mark', () => {
        expect(run('﻿<div sz={{ p: 4 }}></div>').code).toBe('﻿<div class="p-4"></div>');
    });

    it('reports the quoted shorthand Svelte cannot parse, with the form it reads', () => {
        const source = '<div sz="{ p: 4 }"></div>';
        const result = run(source);
        expect(result.code).toBe(source);
        expect(result.diagnostics).toHaveLength(1);
        const [diagnostic] = result.diagnostics;
        expect(diagnostic).toMatchObject({
            severity: 'error',
            code: 'template-unparsable',
            args: { form: 'svelte-quoted', message: expect.any(String) },
        });
        const { message } = diagnostic.args as { message: string };
        expect(diagnostic.message).toBe(
            `[csszyx] template-unparsable: App.svelte:${diagnostic.line}:${diagnostic.column}\n` +
                '  Svelte cannot parse this file, so no `sz` attribute in it gets a class.\n' +
                '  help: write a quoted sz object as an expression, `sz={{ p: 4 }}`; Svelte does not parse `sz="{ p: 4 }"`.\n' +
                `  note: the Svelte compiler reported: ${message.replace(/\.$/, '')}.\n` +
                '  docs: https://csszyx.com/e/template-unparsable',
        );
    });

    it('reports markup Svelte cannot parse instead of skipping it', () => {
        const source = '<script>let a: number = 1;</script>\n<div sz={{ p: 4 }}></div>';
        const result = run(source);
        expect(result.code).toBe(source);
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
        expect(result.diagnostics[0]).toMatchObject({
            code: 'template-unparsable',
            args: { form: 'svelte-preprocess' },
        });
        expect(result.diagnostics[0].message).toContain(
            '  help: run csszyx after the preprocessors that turn this file into Svelte, such as TypeScript without `lang="ts"`, or pug.\n',
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
        const result = plugin.transform.call(context, '<div sz={{ p: 4 }}></div>', '/a.svelte');
        expect(result?.map).toMatchObject({ version: 3, sources: ['/a.svelte'] });
    });
});

describe('reading edges', () => {
    it('quotes an unquoted class value it joins', () => {
        expect(preprocess('<div class=a sz={{ p: 4 }}></div>', { parser: 'wasm' }).code).toBe(
            '<div class="a p-4"></div>',
        );
    });

    it.each([
        ['bare', '<i sz></i>'],
        ['text and an expression', '<i sz="a{b}"></i>'],
    ])('leaves an sz value that is %s alone', (_name, source) => {
        expect(preprocess(source)).toMatchObject({ code: source, diagnostics: [] });
    });

    it("lets a failure of Svelte's parser that is not about the markup through", () => {
        // Svelte's parser runs out of stack near 1,000 levels of nesting.
        const source = `${'<div>'.repeat(5_000)}<i sz={{ p: 4 }}></i>${'</div>'.repeat(5_000)}`;
        expect(() => preprocess(source)).toThrow(RangeError);
    });
});
