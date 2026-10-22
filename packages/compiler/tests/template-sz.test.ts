/**
 * `rewriteTemplateSz` lowers the `sz` values a Vue or Svelte adapter found,
 * through the engine, on both artifacts. A template has no csszyx runtime, so
 * only a value the engine resolves to one class string gets a class; every
 * other value is an error placed in the template file, and its attribute is
 * left as written.
 */
import { describe, expect, it, vi } from 'vitest';
import { type CsszyxError, isCsszyxError } from '../src/errors.js';
import {
    mayHoldSzAttribute,
    placeTemplateDiagnostic,
    reportTemplateSzDiagnostics,
    rewriteTemplateSz,
    type TemplateSzAttribute,
    transformTemplateFile,
} from '../src/internal.js';
import { TEMPLATE_LANG_UNSUPPORTED, TEMPLATE_RUNTIME_VALUE } from '../src/report.js';

const PARSERS = ['rust', 'wasm'] as const;

/**
 * Find each `sz={...}` in a file the simple way: one attribute per line,
 * value up to the last `}` on the line.
 * @param file - The template file.
 * @returns The attributes.
 */
function attributesOf(file: string): TemplateSzAttribute[] {
    const found: TemplateSzAttribute[] = [];
    for (const match of file.matchAll(/sz=\{(.*)\}(?=[ >/])/g)) {
        const start = match.index;
        found.push({
            start,
            end: start + match[0].length,
            value: { source: match[1], start: start + 4 },
        });
    }
    return found;
}

describe.each(PARSERS)('rewriteTemplateSz on the %s artifact', parser => {
    const rewrite = (file: string, filename?: string) =>
        rewriteTemplateSz(file, attributesOf(file), {
            filename,
            parser,
        });

    it('writes the class of every value the engine resolves, escaped', () => {
        const file = `<a sz={{ p: 4 }} />\n<b sz={{}} />\n<i sz={{ content: '"{x}' }} />`;
        expect(rewrite(file)).toMatchObject({
            code: '<a class="p-4" />\n<b class="" />\n<i class="content-[&#34;&#123;x&#125;]" />',
            count: 3,
            classNames: ['p-4', '', 'content-["{x}]'],
            diagnostics: [],
            map: { version: 3 },
        });
    });

    it("writes the class under the project's Tailwind prefix", () => {
        const file = '<a sz={{ p: 4, hover: { m: 2 } }} />';
        const result = rewriteTemplateSz(file, attributesOf(file), {
            parser,
            classPrefix: 'tw',
        });
        expect(result.code).toBe('<a class="tw:p-4 tw:hover:m-2" />');
    });

    it('leaves a whole value the runtime resolves as written', () => {
        const result = rewrite('<a sz={styles} />');
        expect(result.code).toBe('<a sz={styles} />');
        expect(result.classNames).toEqual([null]);
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
    });

    it('leaves a value only the runtime knows as written, with an error', () => {
        const file = '<a sz={{ p: 4 }} />\n  <b sz={{ m: size }} />';
        const result = rewrite(file, 'App.vue');
        expect(result.code).toBe('<a class="p-4" />\n  <b sz={{ m: size }} />');
        expect(result.classNames).toEqual(['p-4', null]);
        expect(result.diagnostics).toEqual([
            {
                severity: 'error',
                message:
                    '[csszyx] template-runtime-value: App.vue:2:10\n' +
                    '  This `sz` value is only known at runtime, and a template has no csszyx runtime to resolve it, so it gets no class.\n' +
                    '  help: write the value as a literal, such as `{ p: 4 }`, or bind `class` or `style` yourself for a value that changes at runtime.\n' +
                    '  note: the attribute is left as written.\n' +
                    '  docs: https://csszyx.com/e/template-runtime-value',
                code: 'template-runtime-value',
                args: {},
                file: 'App.vue',
                line: 2,
                column: 10,
            },
        ]);
    });

    it('places a syntax error where the engine found it', () => {
        const result = rewrite('<a sz={{ p: 4 m: 2 }} />');
        expect(result.diagnostics.map(d => [d.severity, d.line, d.column])).toEqual([
            ['error', 1, 15],
        ]);
        expect(result.diagnostics[0]).toMatchObject({
            code: 'parse-error',
            args: { form: 'expression' },
            message:
                '[csszyx] parse-error: 1:15\n' +
                '  This `sz` value could not be parsed as a JavaScript expression.\n' +
                '  help: write the value as an object literal, such as `{ p: 4 }`.\n' +
                '  note: the attribute is left as written, and no class is generated for it.\n' +
                '  docs: https://csszyx.com/e/parse-error',
        });
    });

    it('names the file of a syntax error when it has one', () => {
        const result = rewrite('<a sz={{ p: 4 m: 2 }} />', 'App.vue');
        expect(result.diagnostics[0]).toMatchObject({ file: 'App.vue', line: 1, column: 15 });
        expect(result.diagnostics[0].message).toMatch(/^\[csszyx\] parse-error: App\.vue:1:15\n/);
    });

    it('places a warning on a later line of a value that spans lines', () => {
        const file = '<a sz={{\n  foo: 4 }} />';
        const result = rewriteTemplateSz(
            file,
            [{ start: 3, end: file.length - 3, value: { source: '{\n  foo: 4 }', start: 7 } }],
            { parser },
        );
        expect(result.code).toBe('<a class="foo-4" />');
        expect(result.diagnostics.map(d => [d.severity, d.line, d.column])).toEqual([
            ['warning', 2, 3],
        ]);
        const { message } = result.diagnostics[0];
        expect(message).toMatch(/^\[csszyx\] unknown-key: 2:3\n/);
        expect(result.diagnostics[0]).toMatchObject({ code: 'unknown-key', args: { key: 'foo' } });
        expect(message).toContain('`foo` is not an sz property.');
        // The synthesized module is an implementation detail: its name and its
        // positions must not reach a template author.
        expect(message).not.toContain('csszyx-template-sz');
    });

    it('maps a position through the offsets of a decoded value', () => {
        const result = rewriteTemplateSz(
            'xx{ p: size }',
            [{ start: 0, end: 13, value: { source: '{ p: size }', start: 2, offsets: [9] } }],
            { parser },
        );
        expect(result.diagnostics[0].column).toBe(10);
    });

    it('joins a class to the static class value it names', () => {
        const file = '<a class="x" sz={{ p: 4 }} />';
        const [attribute] = attributesOf(file);
        expect(
            rewriteTemplateSz(
                file,
                [{ ...attribute, classValue: { start: 10, end: 11, quoted: true } }],
                {
                    parser,
                },
            ).code,
        ).toBe('<a class="x p-4" />');
    });

    it('quotes an unquoted class value it joins', () => {
        const file = '<a class=x sz={{ p: 4 }} />';
        const [attribute] = attributesOf(file);
        expect(
            rewriteTemplateSz(
                file,
                [{ ...attribute, classValue: { start: 9, end: 10, quoted: false } }],
                {
                    parser,
                },
            ).code,
        ).toBe('<a class="x p-4" />');
    });

    it('fills an empty class value and drops an sz with no class', () => {
        const file = '<a class="" sz={{ p: 4 }} />\n<b class="y" sz={{}} />';
        const [first, second] = attributesOf(file);
        const y = file.indexOf('y"');
        const result = rewriteTemplateSz(
            file,
            [
                { ...first, classValue: { start: 10, end: 10, quoted: true } },
                { ...second, classValue: { start: y, end: y + 1, quoted: true } },
            ],
            { parser },
        );
        expect(result.code).toBe('<a class="p-4" />\n<b class="y" />');
    });

    it('maps the rewritten file back to the template', () => {
        const file = '<a sz={{ p: 4 }} />';
        const result = rewriteTemplateSz(file, attributesOf(file), {
            parser,
            filename: 'A.svelte',
        });
        expect(result.map).toMatchObject({
            version: 3,
            sources: ['A.svelte'],
            sourcesContent: [file],
        });
    });

    it('lowers nothing for a file with no attributes', () => {
        expect(rewriteTemplateSz('<a />', [], { parser })).toEqual({
            code: '<a />',
            count: 0,
            classNames: [],
            diagnostics: [],
            map: null,
        });
    });
});

describe('the engine artifact', () => {
    it('is the build default when none is named', () => {
        const file = '<a sz={{ p: 4 }} />';
        expect(rewriteTemplateSz(file, attributesOf(file)).code).toBe('<a class="p-4" />');
    });
});

describe('transformTemplateFile', () => {
    const reporter = throwingReporter();
    const same = (source: string) => ({ code: source, diagnostics: [] });

    it.each([
        ['another kind of file', 'sz={a}', 'A.ts'],
        ['a file with no sz=', '<a/>', 'A.vue'],
        ['a file the preprocess leaves alone', 'sz={a}', 'A.vue'],
    ])('returns null for %s', (_name, code, id) => {
        expect(transformTemplateFile(reporter, code, id, '.vue', same)).toBeNull();
    });

    it('returns the changed code, after reporting', () => {
        const preprocess = vi.fn((source: string, filename: string) => ({
            code: `${source}!`,
            diagnostics: [
                {
                    severity: 'warning' as const,
                    message: filename,
                    code: 'unknown-key' as const,
                    args: {},
                    line: 1,
                    column: 1,
                },
            ],
        }));
        expect(transformTemplateFile(reporter, 'sz={a}', 'A.vue', '.vue', preprocess)).toEqual({
            code: 'sz={a}!',
            map: null,
        });
        expect(reporter.warn).toHaveBeenCalledWith('A.vue');
    });
});

/**
 * A reporter that throws the error it is handed, as a plugin context does.
 *
 * @returns The reporter, its calls recorded.
 */
function throwingReporter() {
    return {
        warn: vi.fn(),
        error: vi.fn((error: CsszyxError): never => {
            throw error;
        }),
    };
}

describe('reportTemplateSzDiagnostics', () => {
    it('passes each warning on and fails once with every error, as a csszyx error', () => {
        const reporter = throwingReporter();
        const at = { line: 1, column: 1, code: 'unknown-key' as const, args: {} };
        let thrown: unknown;
        try {
            reportTemplateSzDiagnostics(reporter, [
                { ...at, severity: 'error', message: 'a', file: 'A.vue' },
                { ...at, severity: 'warning', message: 'w' },
                { ...at, severity: 'error', message: 'b' },
            ]);
        } catch (error) {
            thrown = error;
        }
        expect(isCsszyxError(thrown)).toBe(true);
        expect(thrown).toMatchObject({
            code: 'template-sz-invalid',
            args: { count: 2 },
            message:
                '[csszyx] template-sz-invalid: A.vue\n' +
                '  This file has 2 `sz` error(s), so the build stops.\n' +
                '  help: fix each error listed below.\n' +
                '  docs: https://csszyx.com/e/template-sz-invalid\n\na\n\nb',
        });
        expect(reporter.warn).toHaveBeenCalledWith('w');
    });

    it('heads the errors of a file with no name with the count alone', () => {
        const reporter = throwingReporter();
        const error = { line: 1, column: 1, code: 'unknown-key' as const, args: {} };
        expect(() =>
            reportTemplateSzDiagnostics(reporter, [{ ...error, severity: 'error', message: 'a' }]),
        ).toThrow(/^\[csszyx\] template-sz-invalid:\n {2}This file has 1 `sz` error\(s\)/);
    });

    it('does not fail without an error', () => {
        const reporter = {
            warn: vi.fn(),
            error: vi.fn() as unknown as (error: CsszyxError) => never,
        };
        reportTemplateSzDiagnostics(reporter, []);
        expect(reporter.error).not.toHaveBeenCalled();
    });
});

describe('the template-file helpers', () => {
    it.each([
        ['sz=', true],
        ['sz = "{}"', true],
        [':sz\n=', true],
        ['size', false],
        ['sz', false],
    ])('tells whether %j may hold an sz attribute', (source, expected) => {
        expect(mayHoldSzAttribute(source)).toBe(expected);
    });

    it.each([
        [0, 1, 1],
        [2, 2, 1],
        [5, 3, 2],
    ])('places offset %i on line %i, column %i', (offset, line, column) => {
        const placed = placeTemplateDiagnostic({
            file: 'a\nb\ncd',
            severity: 'warning',
            offset,
            diagnostic: TEMPLATE_RUNTIME_VALUE,
            args: {},
        });
        expect([placed.line, placed.column]).toEqual([line, column]);
    });

    it('places a diagnostic of its own in the file', () => {
        expect(
            placeTemplateDiagnostic({
                file: 'a\nbc',
                filename: 'A.vue',
                severity: 'error',
                offset: 3,
                diagnostic: TEMPLATE_LANG_UNSUPPORTED,
                args: { lang: 'pug' },
            }),
        ).toEqual({
            severity: 'error',
            message:
                '[csszyx] template-lang-unsupported: A.vue:2:2\n' +
                '  This template is `<template lang="pug">`, and csszyx reads `sz` in HTML templates only, so no `sz` attribute in it gets a class.\n' +
                '  help: write the template in HTML, or bind `class` yourself in it.\n' +
                '  docs: https://csszyx.com/e/template-lang-unsupported',
            code: 'template-lang-unsupported',
            args: { lang: 'pug' },
            file: 'A.vue',
            line: 2,
            column: 2,
        });
    });
});
