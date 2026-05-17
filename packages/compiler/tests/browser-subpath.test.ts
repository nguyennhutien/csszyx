import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type PackageJson = {
    exports: {
        './browser': {
            import: { types: string; default: string };
            require: { types: string; default: string };
        };
    };
};

describe('@csszyx/compiler/browser subpath', () => {
    it('exports the browser-pure transform-core bundle', () => {
        const pkg = JSON.parse(
            readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
        ) as PackageJson;

        expect(pkg.exports['./browser']).toEqual({
            import: {
                types: './dist/transform-core.d.mts',
                default: './dist/transform-core.mjs',
            },
            require: {
                types: './dist/transform-core.d.cts',
                default: './dist/transform-core.cjs',
            },
        });
    });

    it('keeps the moduleResolution:node type stub on transform-core', () => {
        const stub = readFileSync(new URL('../browser.d.ts', import.meta.url), 'utf8');

        expect(stub).toContain("export * from './dist/transform-core'");
        expect(stub).not.toContain('./dist/index');
    });

    it('keeps transform-core free of server parser dependencies', () => {
        const source = readFileSync(new URL('../src/transform-core.ts', import.meta.url), 'utf8');

        expect(source).not.toContain('oxc-parser');
        expect(source).not.toContain('@babel/');
        expect(source).not.toContain('magic-string');
    });
});
