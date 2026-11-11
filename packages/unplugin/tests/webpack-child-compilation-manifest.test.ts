/**
 * A child compilation must not emit the build manifest.
 *
 * The asset stage is tapped on `compiler.hooks.compilation`, which webpack
 * copies onto every child compiler (html-webpack-plugin's template compile,
 * for one). The child reached the stage while the parent was still
 * transforming, so it wrote `csszyx-manifest.json` from a census that a file
 * the prescan never read had not joined yet. webpack then merged the child's
 * copy into the parent and failed the build with `Conflict: Multiple assets
 * emit different content to the same filename csszyx-manifest.json`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import webpack, { type Compiler, type Configuration, type Stats } from 'webpack';

import { webpackPlugin } from '../src/unplugin.js';

// A webpack compile with a child; the first run took 21 s under vitest
// in the devcontainer (2026-11-07), most of it loading the engine.
const WEBPACK_TEST_TIMEOUT_MS = 60_000;

const tempDirs: string[] = [];

// csszyx runs as an `enforce: 'pre'` loader, so it lowers `sz` first; this
// normal loader then turns the JSX it left into calls webpack can parse.
const JSX_LOADER = `const { transformSync } = require(${JSON.stringify(createRequire(import.meta.url).resolve('esbuild'))});
module.exports = function (source) {
    return transformSync(source, { loader: 'jsx', jsxFactory: 'h' }).code;
};
`;

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** Compiles one more entry as a child, the way html-webpack-plugin compiles its template. */
class ChildCompilePlugin {
    /**
     * @param compiler - Parent compiler.
     */
    apply(compiler: Compiler): void {
        compiler.hooks.make.tapAsync('child-compile', (compilation, done) => {
            const child = compilation.createChildCompiler('child-compile', {
                filename: 'child.js',
            });
            new compiler.webpack.EntryPlugin(compiler.context, './src/child.js', {
                name: 'child',
            }).apply(child);
            child.runAsChild(error => done(error ?? undefined));
        });
    }
}

describe('webpack child compilation', () => {
    it('leaves the manifest to the parent when a file the prescan skipped adds classes', {
        timeout: WEBPACK_TEST_TIMEOUT_MS,
    }, async () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-webpack-child-'));
        tempDirs.push(root);
        // `build/` is a folder the prescan walk never enters, so the classes of
        // this module are found only when webpack transforms it.
        mkdirSync(join(root, 'src/build'), { recursive: true });
        writeFileSync(
            join(root, 'src/index.jsx'),
            "import { Late } from './build/late.jsx';\nconst h = () => null;\nexport const App = () => <Late />;\n",
            'utf8',
        );
        writeFileSync(
            join(root, 'src/build/late.jsx'),
            'const h = () => null;\nexport const Late = () => <div sz={{ p: 97, mt: 83 }} />;\n',
            'utf8',
        );
        writeFileSync(join(root, 'src/child.js'), 'export const child = 1;\n', 'utf8');
        writeFileSync(join(root, 'jsx-loader.cjs'), JSX_LOADER, 'utf8');

        const config: Configuration = {
            mode: 'production',
            context: root,
            entry: './src/index.jsx',
            output: { path: join(root, 'dist'), filename: 'bundle.js' },
            module: {
                rules: [
                    {
                        test: /\.jsx$/,
                        loader: join(root, 'jsx-loader.cjs'),
                    },
                ],
            },
            plugins: [
                new ChildCompilePlugin(),
                webpackPlugin({
                    build: { cache: false, emitManifest: true },
                }) as webpack.WebpackPluginInstance,
            ],
        };

        await new Promise<void>((resolve, reject) => {
            webpack(config, (error: Error | null | undefined, stats: Stats | undefined) => {
                if (error) {
                    reject(error);
                    return;
                }
                if (stats?.hasErrors()) {
                    reject(new Error(stats.toString({ all: false, errors: true })));
                    return;
                }
                resolve();
            });
        });

        const manifest = JSON.parse(
            readFileSync(join(root, 'dist/csszyx-manifest.json'), 'utf8'),
        ) as { classes: string[] };
        expect(manifest.classes).toEqual(expect.arrayContaining(['p-97', 'mt-83']));
    });
});
