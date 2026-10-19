/**
 * A Vue template lowers `sz` through the engine the bundler runs, on both
 * artifacts, and only what the engine resolves to one class string at build
 * time: a template has no csszyx runtime for the rest. Every other value is an
 * error placed in the `.vue` file, and its attribute is left as written.
 */
import { describe, expect, it, vi } from 'vitest';

import { preprocess, transformTemplate, vitePlugin } from '../src/index.js';

const PARSERS = ['rust', 'wasm'] as const;

/**
 * Wrap one template line in an SFC whose template starts on line 2.
 * @param line - The template body.
 * @returns The SFC source.
 */
function sfc(line: string): string {
    return `<script setup>const size = 4;</script>\n<template>${line}</template>\n`;
}

const RUNTIME =
    'this sz value is only known at runtime, and a template has no csszyx runtime to resolve it\n' +
    'help: write the value as a literal, e.g. { p: 4 }, or bind class or style yourself for a value that changes at runtime\n' +
    'note: the attribute is left as written; no class is generated for it';

describe.each(PARSERS)('the %s artifact', parser => {
    const run = (source: string) => preprocess(source, { filename: 'App.vue', parser });

    it("writes the class under the project's Tailwind prefix", () => {
        const result = preprocess('<template><div sz="{ p: 4 }"></div></template>', {
            parser,
            classPrefix: 'tw',
        });
        expect(result.code).toBe('<template><div class="tw:p-4"></div></template>');
    });

    it('lowers a template literal with no substitution like a quoted string', () => {
        const result = run(sfc('<div :sz="{ p: `4` }" />'));
        expect(result.code).toBe(sfc('<div class="p-4" />'));
        expect(result.diagnostics).toEqual([]);
    });

    it.each([
        ['a quoted value', '<Card sz="{ p: 4 }" />'],
        ['a bound value', '<Card :sz="{ p: 4 }" />'],
        ['a kebab-case component', '<ui-card :sz="{ p: 4 }" />'],
    ])('writes a class on a component, as on a tag, for %s', (_name, tag) => {
        const result = run(sfc(tag));
        expect(result.code).toBe(sfc(tag.replace(/:?sz="\{ p: 4 \}"/, 'class="p-4"')));
        expect(result.diagnostics).toEqual([]);
    });

    it("leaves a component's own sz passed through v-bind alone", () => {
        const source = sfc('<Avatar v-bind="{ sz: size }" />');
        expect(run(source)).toMatchObject({ code: source, diagnostics: [] });
    });

    it.each([
        ['CJK text before the value', '<p>日本語</p><div sz="{ foo: 4 }"></div>'],
        ['an emoji before the value', '<p>😀😀</p><div sz="{ foo: 4 }"></div>'],
        ['an emoji inside the value', `<div sz="{ content: '😀', foo: 4 }"></div>`],
        ['CJK inside the value', `<div sz="{ content: '漢字', foo: 4 }"></div>`],
    ])('places a warning by UTF-16 column with %s', (_name, line) => {
        const source = `<script setup>const size = 4;</script>\n<template>${line}</template>\n`;
        const offset = source.indexOf('foo');
        const lineStart = source.lastIndexOf('\n', offset) + 1;
        const [warning] = run(source).diagnostics;
        expect([warning.line, warning.column]).toEqual([
            source.slice(0, offset).split('\n').length,
            offset - lineStart + 1,
        ]);
    });

    it('lowers a static array of objects', () => {
        expect(run(sfc('<div :sz="[{ p: 4 }, { m: 2 }]" />')).code).toBe(
            sfc('<div class="p-4 m-2" />'),
        );
    });

    it.each([
        ['a variable', '{ p: size }'],
        ['an array value', '{ p: [4] }'],
        ['a call', '{ p: pad() }'],
        ['a conditional', '{ p: big ? 8 : 4 }'],
        ['a template with a substitution', '{ p: `${size}` }'],
        ['a bare identifier', 'styles'],
    ])('reports %s as an error and leaves the attribute as written', (_name, value) => {
        const source = sfc(`<div :sz="${value}" />`);
        const result = run(source);
        expect(result.code).toBe(source);
        expect(result.transformed).toBe(false);
        expect(result.diagnostics).toEqual([
            {
                severity: 'error',
                message: `[csszyx] App.vue:2:21: ${RUNTIME}`,
                line: 2,
                column: 21,
            },
        ]);
    });

    it('lowers the good attribute beside a bad one', () => {
        const result = run(
            '<template>\n  <div :sz="{ p: 4 }">a</div>\n  <span :sz="{ m: size }">b</span>\n</template>',
        );
        expect(result.code).toBe(
            '<template>\n  <div class="p-4">a</div>\n  <span :sz="{ m: size }">b</span>\n</template>',
        );
        expect(result.count).toBe(1);
        expect(result.diagnostics.map(d => [d.severity, d.line, d.column])).toEqual([
            ['error', 3, 14],
        ]);
    });

    it('escapes the class it writes', () => {
        const result = run(sfc(`<div :sz='{ content: "x\\" onclick=\\"y" }' />`));
        expect(result.code).toBe(sfc('<div class="content-[x&#34; onclick=&#34;y]" />'));
    });

    it('decodes character references the way Vue does before lowering', () => {
        expect(run(sfc(`<div :sz="{ content: '&quot;&#123;&#x7d;' }" />`)).code).toBe(
            sfc('<div class="content-[&#34;&#123;&#125;]" />'),
        );
    });

    it('places a syntax error after a decoded reference in the file', () => {
        const result = run(sfc(`<div :sz="{ content: '&quot;', p: 4 m: 2 }" />`));
        expect(result.diagnostics).toEqual([
            {
                severity: 'error',
                message:
                    '[csszyx] App.vue:2:47: this sz value could not be parsed as a JavaScript expression\n' +
                    'note: the attribute is left as written; no class is generated for it',
                line: 2,
                column: 47,
            },
        ]);
    });

    it('reports an engine warning at its key and still writes the class', () => {
        const result = run(sfc('<div sz="{ foo: 4 }" />'));
        expect(result.code).toBe(sfc('<div class="foo-4" />'));
        expect(result.diagnostics).toHaveLength(1);
        const [diagnostic] = result.diagnostics;
        // The position is the key's, in the file the user wrote.
        expect(diagnostic).toMatchObject({ severity: 'warning', line: 2, column: 22 });
        expect(diagnostic.message).toContain('App.vue:2:22');
        expect(diagnostic.message).toContain('`foo` is not an sz property.');
        expect(diagnostic.message).toContain('docs: https://csszyx.com/e/unknown-key');
        // The module the value was lowered in is never shown, and the message
        // opens with one header only.
        expect(diagnostic.message).not.toContain('csszyx-template-sz');
        expect(diagnostic.message.match(/\[csszyx\]/g)).toHaveLength(1);
    });

    it('writes an empty class for an empty object', () => {
        expect(run(sfc('<div :sz="{}" />')).code).toBe(sfc('<div class="" />'));
    });
});

describe('transformTemplate', () => {
    it('places a diagnostic in the template string when no file is named', () => {
        const result = transformTemplate('<div :sz="{ p: size }" />');
        expect(result.diagnostics[0].message.startsWith('[csszyx] 1:11: this sz value')).toBe(true);
    });

    it('leaves a plain sz string that is not an object or an array alone', () => {
        const source = '<Icon sz="lg" />';
        expect(transformTemplate(source)).toEqual({
            code: source,
            count: 0,
            transformed: false,
            diagnostics: [],
            map: null,
        });
    });
});

describe('the Vite plugin', () => {
    type Context = { error: (message: string) => never; warn: (message: string) => void };
    type Transform = (this: Context, code: string, id: string) => { code: string } | null;

    /**
     * Run the plugin's transform with a recording bundler context.
     * @param code - The SFC source.
     * @returns The result and the context's recorded calls.
     */
    function transform(code: string) {
        const context = {
            error: vi.fn((message: string): never => {
                throw new Error(message);
            }),
            warn: vi.fn(),
        };
        const hook = vitePlugin({ parser: 'wasm' }).transform as unknown as Transform;
        let result: { code: string } | null | Error;
        try {
            result = hook.call(context, code, '/src/App.vue');
        } catch (error) {
            result = error as Error;
        }
        return { result, context };
    }

    it('fails the build on an error, naming the file and position', () => {
        const { result, context } = transform(sfc('<div :sz="{ p: size }" />'));
        expect(result).toBeInstanceOf(Error);
        expect(context.error).toHaveBeenCalledWith(`[csszyx] /src/App.vue:2:21: ${RUNTIME}`);
    });

    it('passes a warning to the bundler and keeps the output', () => {
        const { result, context } = transform(sfc('<div :sz="{ foo: 4 }" />'));
        expect((result as { code: string }).code).toContain('class="foo-4"');
        expect(context.warn).toHaveBeenCalledTimes(1);
        expect(context.error).not.toHaveBeenCalled();
    });
});
