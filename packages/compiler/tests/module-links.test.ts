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

        expect(result).toEqual([
            { cssImports: ['./a.css'], forwards: [] },
            { cssImports: [], forwards: [] },
            {
                cssImports: [],
                forwards: [{ exportName: 'c', importedName: 'c', specifier: './c' }],
            },
        ]);
    });
});
