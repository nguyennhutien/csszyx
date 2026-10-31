/**
 * Module links through both artifacts of the engine.
 *
 * The rules themselves are pinned by the Rust unit tests beside the scan; this
 * suite asks the question those cannot: whether the napi and wasm boundaries
 * hand the same answer to JavaScript.
 */
import { describe, expect, it } from 'vitest';

import { LINK_SCANNERS } from './engine-parity-harness.js';

describe.each(LINK_SCANNERS)('the %s artifact', (_name, scan) => {
    it('reads the stylesheets a module requests, statically or through import()', () => {
        const [links] = scan([
            {
                filename: '/p/main.tsx',
                source: "import '@workspace/ui/globals.css';\nimport url from './a.css?url';\nconst lazy = () => import('./lazy.css');\n// import './commented.css';\n",
            },
        ]);

        expect(links?.cssImports).toEqual([
            '@workspace/ui/globals.css',
            './a.css?url',
            './lazy.css',
        ]);
    });

    it('decodes an escaped static stylesheet specifier before classifying it', () => {
        const [links] = scan([
            { filename: '/p/main.tsx', source: String.raw`import './theme\u002ecss';` },
        ]);

        expect(links?.cssImports).toEqual(['./theme.css']);
    });

    it('decodes an escaped dynamic stylesheet specifier before classifying it', () => {
        const [links] = scan([
            {
                filename: '/p/main.tsx',
                source: String.raw`const load = () => import('./theme\u002ecss?inline');`,
            },
        ]);

        expect(links?.cssImports).toEqual(['./theme.css?inline']);
    });

    it('reads a re-export as a link to the provider', () => {
        const [links] = scan([
            { filename: '/p/index.ts', source: "import card from './styles';\nexport { card };" },
        ]);

        expect(links?.forwards).toEqual([
            { exportName: 'card', importedName: 'default', specifier: './styles' },
        ]);
    });

    it('keeps a generated barrel in statement order', () => {
        const count = 2_048;
        const source = Array.from(
            { length: count },
            (_, index) => `export { x${index} as public${index} } from './m${index}';`,
        ).join('\n');
        const [links] = scan([{ filename: '/p/index.ts', source }]);

        expect(links?.forwards).toHaveLength(count);
        expect(links?.forwards[0]).toEqual({
            exportName: 'public0',
            importedName: 'x0',
            specifier: './m0',
        });
        expect(links?.forwards.at(-1)).toEqual({
            exportName: `public${count - 1}`,
            importedName: `x${count - 1}`,
            specifier: `./m${count - 1}`,
        });
    });

    it('answers one entry per module, in input order', () => {
        const result = scan([
            { filename: '/p/a.ts', source: "import './a.css';" },
            { filename: '/p/b.ts', source: 'export const b = 1;' },
            { filename: '/p/c.ts', source: "export { c } from './c';" },
        ]);

        // The answers a query did not ask for come back empty.
        const unasked = {
            moduleSyntax: false,
            loads: [],
            styleCss: [],
            styleMarkup: [],
            parseFailed: false,
        };
        expect(result).toEqual([
            { cssImports: ['./a.css'], forwards: [], registryEntries: [], ...unasked },
            { cssImports: [], forwards: [], registryEntries: [], ...unasked },
            {
                cssImports: [],
                forwards: [{ exportName: 'c', importedName: 'c', specifier: './c' }],
                registryEntries: [],
                ...unasked,
            },
        ]);
    });

    it('reads registry entries only when the query asks', () => {
        // A stylesheet or forward scan does not pay for the evaluation.
        const files = [{ filename: '/p/s.ts', source: 'export const card = { p: 4 };' }];
        expect(scan(files)[0]?.registryEntries).toEqual([]);
        expect(scan(files, { registryEntries: true })[0]?.registryEntries).toEqual([
            { kind: 'sz-object', exportName: 'card', value: { p: 4 } },
        ]);
    });

    // The module facts and style texts come from the parse, so text that only
    // looks like a statement or a selector boundary decides nothing.
    it('reads the module format from code alone', () => {
        const formats = scan(
            [
                "/*\nexport * from 'a';\n*/\nrequire('a');",
                'import(`a`).then(() => `${import.meta.url}`);',
                "const r = /'/;\nexport const a = r;",
            ].map((source, index) => ({ filename: `/p/m${index}.js`, source })),
            { moduleFacts: true },
        ).map(links => links.moduleSyntax);

        expect(formats).toEqual([false, true, true]);
    });

    it('lists every module a source loads, with the name it reads', () => {
        const [links] = scan(
            [
                {
                    filename: '/p/m.js',
                    source: "import { szr } from '@csszyx/runtime';\nexport * from 'csszyx';\nrequire('r');\nimport('q');\n// require('no');",
                },
            ],
            { moduleFacts: true },
        );

        expect(links?.loads).toEqual([
            { specifier: '@csszyx/runtime', name: 'szr' },
            { specifier: 'csszyx' },
            { specifier: 'r' },
            { specifier: 'q' },
        ]);
    });

    it('reads every string inside a style element, escapes decoded', () => {
        const [links] = scan(
            [
                {
                    filename: '/p/a.tsx',
                    source: String.raw`export const A = () => <><style>{/'/.test("'") && '[class~="pb-[2px]"] {}'}</style>
<style>{'.pb-2 {}'}</style></>;
const page = '<style>.c {}</style>';`,
                },
            ],
            { styleTexts: true },
        );

        expect(links?.styleCss).toEqual(["'", '[class~="pb-[2px]"] {}', '.pb-2 {}']);
        expect(links?.styleMarkup).toEqual(['<style>.c {}</style>']);
    });

    it('reads the loads a call, a template or an import-equals spells, and none a type spells', () => {
        const [typed, called, escaped] = scan(
            [
                {
                    filename: '/p/a.ts',
                    source: "import type { szr } from 'r';\nexport type * from 'q';\nimport t = require('t');\n",
                },
                { filename: '/p/b.js', source: 'require(`r`);\nimport(`q`);\n' },
                { filename: '/p/c.js', source: "import('@csszyx\\/runtime');\n" },
            ],
            { moduleFacts: true },
        );

        expect(typed?.loads).toEqual([{ specifier: 't' }]);
        expect(called?.loads).toEqual([{ specifier: 'r' }, { specifier: 'q' }]);
        // The specifier a module resolves, its escapes decoded.
        expect(escaped?.loads).toEqual([{ specifier: '@csszyx/runtime' }]);
    });

    it('says when the parse stopped on a syntax error', () => {
        const source = "import type { A } from './a';\n";
        const [js, ts] = scan(
            [
                { filename: '/p/a.js', source },
                { filename: '/p/a.ts', source },
            ],
            { moduleFacts: true },
        );

        expect(js?.parseFailed).toBe(true);
        expect(ts?.parseFailed).toBe(false);
    });

    it('reads JSX in a plain JavaScript file, as the transform does', () => {
        const [links] = scan(
            [{ filename: '/p/a.js', source: "export const A = () => <style>{'.a {}'}</style>;" }],
            { styleTexts: true },
        );

        expect(links?.styleCss).toEqual(['.a {}']);
    });

    // A batch past one run's length goes in several calls on wasm; every file
    // is still answered once, in order.
    it('answers a batch longer than one run, in order', () => {
        const padding = `// ${'x'.repeat(5 << 20)}\n`;
        const files = ['a', 'b', 'c'].map(name => ({
            filename: `/p/${name}.ts`,
            source: `${padding}import './${name}.css';\n`,
        }));
        expect(scan(files).map(links => links.cssImports)).toEqual([
            ['./a.css'],
            ['./b.css'],
            ['./c.css'],
        ]);
    });
});
