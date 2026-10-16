/**
 * A Svelte template lowers `sz` through the engine the bundler runs, on both
 * artifacts, and only what the engine resolves to one class string at build
 * time: a template has no csszyx runtime for the rest. Every other value is an
 * error placed in the `.svelte` file, and its attribute is left as written.
 */
import { compile } from 'svelte/compiler';
import { describe, expect, it, vi } from 'vitest';

import { preprocess, preprocessor, transformMarkup, vitePlugin } from '../src/index.js';

const PARSERS = ['rust', 'wasm'] as const;

const SCRIPT = '<script>let { size } = $props();</script>\n';

const RUNTIME =
    'this sz value is only known at runtime, and a template has no csszyx runtime to resolve it\n' +
    'help: write the value as a literal, e.g. { p: 4 }, or bind class or style yourself for a value that changes at runtime\n' +
    'note: the attribute is left as written; no class is generated for it';

describe.each(PARSERS)('the %s artifact', parser => {
    const run = (source: string) => preprocess(source, { filename: 'App.svelte', parser });

    it("writes the class under the project's Tailwind prefix", () => {
        const result = preprocess('<div sz={{ p: 4 }}></div>', { parser, classPrefix: 'tw' });
        expect(result.code).toBe('<div class="tw:p-4"></div>');
    });

    it('lowers a template literal with no substitution like a quoted string', () => {
        const result = run(`${SCRIPT}<div sz={{ p: \`4\` }}></div>`);
        expect(result.code).toBe(`${SCRIPT}<div class="p-4"></div>`);
        expect(result.diagnostics).toEqual([]);
    });

    it.each([
        ['a component', '<Card sz={{ p: 4 }} />'],
        ['a dotted component', '<ui.Card sz={{ p: 4 }} />'],
    ])('writes a class on %s, as on a tag', (_name, tag) => {
        const result = run(tag);
        expect(result.code).toBe(tag.replace('sz={{ p: 4 }}', 'class="p-4"'));
        expect(result.diagnostics).toEqual([]);
    });

    it("leaves a component's own sz passed through a spread alone", () => {
        const source = '<Avatar {...{ sz: size }} />';
        expect(run(source)).toMatchObject({ code: source, diagnostics: [] });
    });

    it.each([
        ['CJK text before the value', '<p>日本語</p><div sz={{ foo: 4 }}></div>'],
        ['an emoji before the value', '<p>😀😀</p><div sz={{ foo: 4 }}></div>'],
        ['an emoji inside the value', "<div sz={{ content: '😀', foo: 4 }}></div>"],
        ['CJK inside the value', "<div sz={{ content: '漢字', foo: 4 }}></div>"],
    ])('places a warning by UTF-16 column with %s', (_name, line) => {
        const source = `${SCRIPT}${line}`;
        const offset = source.indexOf('foo');
        const lineStart = source.lastIndexOf('\n', offset) + 1;
        const [warning] = run(source).diagnostics;
        expect([warning.line, warning.column]).toEqual([
            source.slice(0, offset).split('\n').length,
            offset - lineStart + 1,
        ]);
    });

    it('lowers a static array of objects', () => {
        expect(run('<div sz={[{ p: 4 }, { m: 2 }]}></div>').code).toBe(
            '<div class="p-4 m-2"></div>',
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
        const source = `${SCRIPT}<div sz={${value}}></div>`;
        const result = run(source);
        expect(result.code).toBe(source);
        expect(result.diagnostics).toEqual([
            {
                severity: 'error',
                message: `[csszyx] App.svelte:2:10: ${RUNTIME}`,
                line: 2,
                column: 10,
            },
        ]);
    });

    it('lowers the good attribute beside a bad one', () => {
        const result = run(`${SCRIPT}<div sz={{ p: 4 }}>a</div>\n<span sz={{ m: size }}>b</span>`);
        expect(result.code).toBe(
            `${SCRIPT}<div class="p-4">a</div>\n<span sz={{ m: size }}>b</span>`,
        );
        expect(result.diagnostics.map(d => [d.severity, d.line, d.column])).toEqual([
            ['error', 3, 11],
        ]);
    });

    it('escapes the class it writes, so Svelte reads one attribute with the class', () => {
        const result = run(`<div sz={{ content: 'x" onclick="y{z}' }}></div>`);
        expect(result.code).toBe(
            '<div class="content-[x&#34; onclick=&#34;y&#123;z&#125;]"></div>',
        );
        const { js } = compile(result.code, { generate: 'server' });
        expect(js.code).toContain('class="content-[x&quot; onclick=&quot;y{z}]"');
    });

    it('places a syntax error in the file', () => {
        const result = run(`${SCRIPT}<div sz={{ p: 4 m: 2 }}></div>`);
        expect(result.diagnostics.map(d => [d.severity, d.line, d.column])).toEqual([
            ['error', 2, 17],
        ]);
    });

    it('reports an engine warning at its key and still writes the class', () => {
        const result = run(`${SCRIPT}<div sz={{ foo: 4 }}></div>`);
        expect(result.code).toBe(`${SCRIPT}<div class="foo-4"></div>`);
        expect(result.diagnostics.map(d => [d.severity, d.line, d.column])).toEqual([
            ['warning', 2, 12],
        ]);
    });

    it('does not read sz= inside a script or a style block', () => {
        // One block per line: two close tags on a line read as a regex literal
        // to `check-tag-filter-regexes.mjs`, a text-level gate.
        const script = '<script>let sz={ p: size };</script>';
        const style = '<style>a[sz={x}] {}</style>';
        const head = `${script}\n${style}`;
        const result = run(`${head}\n<div sz={{ p: 4 }}></div>`);
        expect(result.code).toBe(`${head}\n<div class="p-4"></div>`);
        expect(result.diagnostics).toEqual([]);
    });
});

describe('transformMarkup', () => {
    it('places a diagnostic in the markup when no file is named', () => {
        const result = transformMarkup('<div sz={styles}></div>');
        expect(result.diagnostics[0].message.startsWith('[csszyx] 1:10: this sz value')).toBe(true);
    });

    it('leaves a quoted sz string that is not an object alone', () => {
        const source = '<Icon sz="lg"></Icon>';
        expect(transformMarkup(source)).toEqual({ code: source, count: 0, diagnostics: [] });
    });

    it('stops at an unterminated script block', () => {
        const source = '<script>let sz={ p: 4 }';
        expect(transformMarkup(source)).toEqual({ code: source, count: 0, diagnostics: [] });
    });
});

describe('the preprocessor', () => {
    it('throws every error at once, naming the file and position', () => {
        const markup = preprocessor().markup;
        expect(() =>
            markup?.({ content: '<div sz={styles}></div>', filename: 'App.svelte' }),
        ).toThrow(`[csszyx] App.svelte:1:10: ${RUNTIME}`);
    });

    it('prints a warning and keeps the output', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const out = preprocessor().markup?.({ content: '<div sz={{ foo: 4 }}></div>' });
        expect(out && 'code' in out ? out.code : '').toBe('<div class="foo-4"></div>');
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('the Vite plugin', () => {
    type Context = { error: (message: string) => never; warn: (message: string) => void };
    type Transform = (this: Context, code: string, id: string) => { code: string } | null;

    /**
     * Run the plugin's transform with a recording bundler context.
     * @param code - The component source.
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
            result = hook.call(context, code, '/src/App.svelte');
        } catch (error) {
            result = error as Error;
        }
        return { result, context };
    }

    it('fails the build on an error, naming the file and position', () => {
        const { result, context } = transform('<div sz={styles}></div>');
        expect(result).toBeInstanceOf(Error);
        expect(context.error).toHaveBeenCalledWith(`[csszyx] /src/App.svelte:1:10: ${RUNTIME}`);
    });

    it('passes a warning to the bundler and keeps the output', () => {
        const { result, context } = transform('<div sz={{ foo: 4 }}></div>');
        expect((result as { code: string }).code).toBe('<div class="foo-4"></div>');
        expect(context.warn).toHaveBeenCalledTimes(1);
    });
});
