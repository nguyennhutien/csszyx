/**
 * Real webpack build exercising the post-plugin `processAssets` mangle pass.
 *
 * The JSX component that owns the sz classes lives on disk but is NOT the
 * webpack entry, so webpack never parses the JSX; csszyx's own prescan (which
 * uses the compiler directly) discovers the owned classes and builds the mangle
 * map. The CSS asset then flows through the processAssets hook: the manifest is
 * emitted with the map and the owned selector is rewritten to its token.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import webpack, { type Configuration, type Stats } from 'webpack';

import { webpackPlugin } from '../src/unplugin.js';

const WEBPACK_TEST_TIMEOUT_MS = 30_000;
const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Emits a synthetic HTML page and an extra JS asset (both referencing the owned
 * `m-3` class) at an early processAssets stage, so csszyx's later
 * OPTIMIZE_SIZE-stage pass finds and mangles their class attributes/strings.
 */
class EmitExtraAssetsPlugin {
    apply(compiler: webpack.Compiler): void {
        compiler.hooks.thisCompilation.tap('emit-extra', compilation => {
            compilation.hooks.processAssets.tap(
                {
                    name: 'emit-extra',
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
                },
                () => {
                    const { RawSource } = compiler.webpack.sources;
                    compilation.emitAsset(
                        'page.html',
                        new RawSource(
                            '<div class="m-3 author-kept"></div><aside class=\'m-3\'></aside>',
                        ),
                    );
                    compilation.emitAsset('extra.js', new RawSource('var x={className:"m-3"};'));
                },
            );
        });
    }
}

async function runWebpack(root: string): Promise<void> {
    const config: Configuration = {
        mode: 'production',
        context: root,
        entry: './src/index.js',
        output: {
            path: join(root, 'dist'),
            filename: 'bundle.js',
            assetModuleFilename: 'assets/[name][ext]',
        },
        module: { rules: [{ test: /\.css$/, type: 'asset/resource' }] },
        plugins: [
            new EmitExtraAssetsPlugin(),
            webpackPlugin({
                // scanCss registers the CSS as a watched theme dependency,
                // exercising the theme-deps compilation tap.
                build: { emitManifest: true, cache: false, scanCss: ['src/style.css'] },
                production: { mangle: true },
            }) as webpack.WebpackPluginInstance,
        ],
    };
    await new Promise<void>((resolve, reject) => {
        webpack(config, (error: Error | null | undefined, stats: Stats | undefined) => {
            if (error) return reject(error);
            if (stats?.hasErrors())
                return reject(new Error(stats.toString({ all: false, errors: true })));
            resolve();
        });
    });
}

describe('webpack processAssets mangle pass', () => {
    it('mangles owned CSS selectors and emits a manifest carrying the map', {
        timeout: WEBPACK_TEST_TIMEOUT_MS,
    }, async () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-webpack-mangle-'));
        tempDirs.push(root);
        const src = join(root, 'src');
        mkdirSync(src, { recursive: true });
        // Entry only imports CSS — webpack never parses the JSX below.
        writeFileSync(join(src, 'index.js'), "import './style.css';\n", 'utf8');
        // The prescan discovers `m-3` from this owned sz component.
        writeFileSync(
            join(src, 'App.tsx'),
            'export const App = () => <div sz={{ m: 3 }} />;\n',
            'utf8',
        );
        writeFileSync(join(src, 'style.css'), '.m-3 { margin: 0.75rem; }\n', 'utf8');

        await runWebpack(root);

        const manifest = JSON.parse(
            readFileSync(join(root, 'dist/csszyx-manifest.json'), 'utf8'),
        ) as { mangleMap?: Record<string, string>; classes?: string[] };
        expect(manifest.mangleMap).toBeDefined();
        const token = manifest.mangleMap?.['m-3'];
        expect(token).toBeTruthy();

        const css = readFileSync(join(root, 'dist/assets/style.css'), 'utf8');
        // The owned selector is rewritten to its mangled token.
        expect(css).not.toContain('.m-3 ');
        expect(css).toContain(`.${token}`);

        // The HTML page's class attribute is mangled; the author class stays.
        const html = readFileSync(join(root, 'dist/page.html'), 'utf8');
        expect(html).toContain(token as string);
        expect(html).not.toContain('m-3');
        expect(html).toContain('author-kept');
        expect(html).toContain(`<aside class='${token}'></aside>`);

        // The extra JS asset's class string is mangled too.
        const extraJs = readFileSync(join(root, 'dist/extra.js'), 'utf8');
        expect(extraJs).toContain(`"${token}"`);
        expect(extraJs).not.toContain('"m-3"');
    });
});
