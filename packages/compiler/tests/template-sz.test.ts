/**
 * `rewriteTemplateSz` lowers the `sz` values a Vue or Svelte adapter found,
 * through the engine, on both artifacts. A template has no csszyx runtime, so
 * only a value the engine resolves to one class string gets a class; every
 * other value is an error placed in the template file, and its attribute is
 * left as written.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    mayHoldSzAttribute,
    placeTemplateDiagnostic,
    reportTemplateSzDiagnostics,
    rewriteTemplateSz,
    type TemplateSzAttribute,
    transformTemplateFile,
} from '../src/internal.js';

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
                    '[csszyx] App.vue:2:10: this sz value is only known at runtime, and a template has no csszyx runtime to resolve it\n' +
                    'help: write the value as a literal, e.g. { p: 4 }, or bind class or style yourself for a value that changes at runtime\n' +
                    'note: the attribute is left as written; no class is generated for it',
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
        expect(result.diagnostics[0].message).toContain(
            '1:15: this sz value could not be parsed as a JavaScript expression',
        );
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
        expect(result.diagnostics[0].message).toMatch(
            /^\[csszyx\] 2:3: Unknown property "foo" in sz prop\. The class/,
        );
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
    const reporter = {
        warn: vi.fn(),
        error: vi.fn((message: string): never => {
            throw new Error(message);
        }),
    };
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
            diagnostics: [{ severity: 'warning' as const, message: filename, line: 1, column: 1 }],
        }));
        expect(transformTemplateFile(reporter, 'sz={a}', 'A.vue', '.vue', preprocess)).toEqual({
            code: 'sz={a}!',
            map: null,
        });
        expect(reporter.warn).toHaveBeenCalledWith('A.vue');
    });
});

describe('reportTemplateSzDiagnostics', () => {
    it('passes each warning on and fails once with every error', () => {
        const reporter = {
            warn: vi.fn(),
            error: vi.fn((message: string): never => {
                throw new Error(message);
            }),
        };
        const at = { line: 1, column: 1 };
        expect(() =>
            reportTemplateSzDiagnostics(reporter, [
                { ...at, severity: 'error', message: 'a' },
                { ...at, severity: 'warning', message: 'w' },
                { ...at, severity: 'error', message: 'b' },
            ]),
        ).toThrow('a\n\nb');
        expect(reporter.warn).toHaveBeenCalledWith('w');
    });

    it('does not fail without an error', () => {
        const reporter = { warn: vi.fn(), error: vi.fn() as unknown as (m: string) => never };
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
            text: 'x',
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
                text: 'no',
            }),
        ).toEqual({ severity: 'error', message: '[csszyx] A.vue:2:2: no', line: 2, column: 2 });
    });
});
