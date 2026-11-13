/**
 * Real webpack build exercising the post-plugin `processAssets` mangle pass.
 *
 * The JSX component that owns the sz classes lives on disk but is NOT the
 * webpack entry, so webpack never parses the JSX; csszyx's own prescan (which
 * uses the compiler directly) discovers the owned classes and builds the mangle
 * map. The CSS asset then flows through the processAssets hook: the manifest is
 * emitted with the map and the owned selector is rewritten to its token.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CssSyntaxError } from 'postcss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import webpack, { type Configuration, type Stats } from 'webpack';

vi.mock('../src/css-mangler.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/css-mangler.js')>();
    return { ...actual, mangleCSSSync: vi.fn(actual.mangleCSSSync) };
});

import { mangleCSSSync } from '../src/css-mangler.js';
import { webpackPlugin } from '../src/unplugin.js';

const WEBPACK_TEST_TIMEOUT_MS = 30_000;
const tempDirs: string[] = [];

afterEach(() => {
    vi.mocked(mangleCSSSync).mockReset();
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
                            '<div class=" m-3  author-kept "></div><aside class=\'m-3\'></aside>' +
                                // A BOM is not White_Space: the class holding it is one class.
                                '<p class="author-kept\uFEFFx m-3"></p>' +
                                // A name on the map's prototype is not an entry.
                                '<i class="constructor m-3"></i>',
                        ),
                    );
                    compilation.emitAsset(
                        'unchanged.html',
                        new RawSource(
                            '<div class="author-kept"></div><aside class=\'author-other\'></aside>',
                        ),
                    );
                    compilation.emitAsset(
                        'unchanged.css',
                        new RawSource('/* no class selectors */'),
                    );
                    compilation.emitAsset('extra.js', new RawSource('var x={className:"m-3"};'));
                },
            );
        });
    }
}

/**
 * Build the fixture with webpack.
 *
 * @param root - The fixture root.
 * @param build - Options for the plugin's `build`; `emitManifest` left out
 *        builds with its default.
 * @param build.emitManifest - `build.emitManifest`.
 * @param ahead - Plugins registered before csszyx's, as Next registers its own.
 * @param optimization - webpack `optimization` options for the build.
 */
async function runWebpack(
    root: string,
    build: { emitManifest?: boolean } = { emitManifest: true },
    ahead: webpack.WebpackPluginInstance[] = [],
    optimization: Configuration['optimization'] = undefined,
): Promise<void> {
    const config: Configuration = {
        mode: 'production',
        optimization,
        context: root,
        entry: './src/index.js',
        output: {
            path: join(root, 'dist'),
            filename: 'bundle.js',
            assetModuleFilename: 'assets/[name][ext]',
        },
        module: { rules: [{ test: /\.css$/, type: 'asset/resource' }] },
        // A mangling webpack build always carries the map-registration entry,
        // and that module imports the runtime. This fixture is a bare temp
        // directory with no `node_modules`, so the import is declared external
        // — the assertions below are about the emitted assets, not about what
        // the runtime package contains.
        externals: [
            ({ request }, callback) =>
                request?.startsWith('@csszyx/runtime')
                    ? callback(undefined, `commonjs ${request}`)
                    : callback(),
        ],
        plugins: [
            new EmitExtraAssetsPlugin(),
            ...ahead,
            webpackPlugin({
                // scanCss registers the CSS as a watched theme dependency,
                // exercising the theme-deps compilation tap.
                build: {
                    ...build,
                    cache: false,
                    scanCss: ['src/style.css'],
                },
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

describe('the webpack manifest', () => {
    /**
     * Build a one-class fixture and list the output folder.
     *
     * @param emitManifest - `build.emitManifest`, or undefined for the default.
     * @returns The emitted file names.
     */
    async function outputOf(emitManifest: boolean | undefined): Promise<string[]> {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-webpack-manifest-'));
        tempDirs.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/index.js'), "import './style.css';\n", 'utf8');
        writeFileSync(
            join(root, 'src/App.tsx'),
            'export const App = () => <div sz={{ m: 3 }} />;\n',
            'utf8',
        );
        writeFileSync(join(root, 'src/style.css'), '.m-3 { margin: 0.75rem; }\n', 'utf8');
        await runWebpack(root, emitManifest === undefined ? {} : { emitManifest });
        return readdirSync(join(root, 'dist'));
    }

    it('is not emitted by default, as on Vite', { timeout: WEBPACK_TEST_TIMEOUT_MS }, async () => {
        expect(await outputOf(undefined)).not.toContain('csszyx-manifest.json');
    });

    it('is emitted when the build asks for it', { timeout: WEBPACK_TEST_TIMEOUT_MS }, async () => {
        expect(await outputOf(true)).toContain('csszyx-manifest.json');
    });
});

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
        expect(html).toContain('author-kept\uFEFFx');
        expect(/<i class=["']?constructor ([^"'>]+)["']?>/.exec(html)?.[1]).toBe(token);
        const unchanged = readFileSync(join(root, 'dist/unchanged.html'), 'utf8');
        expect(unchanged).toContain('author-kept');
        expect(unchanged).toContain('author-other');
        expect(readFileSync(join(root, 'dist/unchanged.css'), 'utf8')).toBe(
            '/* no class selectors */',
        );
        // Read the attribute rather than a spelling of it: the HTML minifier
        // chooses its own quoting and drops the quotes entirely when the value
        // allows, so asserting one spelling pins a formatting choice that is not
        // this test's subject. What matters is that the element carries the
        // mangled token and nothing else.
        const aside = /<aside class=(["']?)([^"'>]+)\1><\/aside>/.exec(html);
        expect(aside?.[2]).toBe(token);

        // The extra JS asset's class string is mangled too.
        const extraJs = readFileSync(join(root, 'dist/extra.js'), 'utf8');
        expect(extraJs).toContain(`"${token}"`);
        expect(extraJs).not.toContain('"m-3"');
    });
});

/**
 * Stands in for the minimizer Next adds to `plugins` ahead of csszyx's: at
 * `OPTIMIZE_SIZE` it drops the annotation and renames the callee, as a
 * minifier does, so a mark it reaches first can no longer be found.
 */
class MinifierAheadPlugin {
    apply(compiler: webpack.Compiler): void {
        compiler.hooks.thisCompilation.tap('minifier-ahead', compilation => {
            compilation.hooks.processAssets.tap(
                {
                    name: 'minifier-ahead',
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
                },
                assets => {
                    const { RawSource } = compiler.webpack.sources;
                    for (const name of Object.keys(assets).filter(file => file.endsWith('.js'))) {
                        const code = String(assets[name]?.source());
                        const minified = code.replaceAll('/*#__PURE__*/__szCss(', 't(');
                        compilation.updateAsset(name, new RawSource(minified));
                    }
                },
            );
        });
    }
}

/** Emits a chunk carrying a class string the compiler marked. */
class EmitMarkedAssetPlugin {
    apply(compiler: webpack.Compiler): void {
        compiler.hooks.thisCompilation.tap('emit-marked', compilation => {
            compilation.hooks.processAssets.tap(
                {
                    name: 'emit-marked',
                    stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
                },
                () => {
                    const { RawSource } = compiler.webpack.sources;
                    compilation.emitAsset(
                        'marked.js',
                        new RawSource('var y=/*#__PURE__*/__szCss("m-3"),z="m-3";'),
                    );
                },
            );
        });
    }
}

it('inlines a marked class string before a minimizer registered ahead of it', {
    timeout: WEBPACK_TEST_TIMEOUT_MS,
}, async () => {
    // ADR 0034: Next puts its minimizer at OPTIMIZE_SIZE ahead of the plugin's,
    // so the bundle pass runs at OPTIMIZE, before any of them.
    const root = mkdtempSync(join(tmpdir(), 'csszyx-webpack-mark-order-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/index.js'), "import './style.css';");
    writeFileSync(join(root, 'src/App.tsx'), 'export const App = () => <div sz={{ m: 3 }} />;');
    writeFileSync(join(root, 'src/style.css'), '.m-3 { margin: 0.75rem; }');

    await runWebpack(root, { emitManifest: true }, [
        new EmitMarkedAssetPlugin(),
        new MinifierAheadPlugin(),
    ]);

    const map = JSON.parse(readFileSync(join(root, 'dist/csszyx-manifest.json'), 'utf8')) as {
        mangleMap?: Record<string, string>;
    };
    const token = map.mangleMap?.['m-3'];
    expect(token).toBeTruthy();
    const marked = readFileSync(join(root, 'dist/marked.js'), 'utf8');
    expect(marked).toBe(`var y="${token}",z="m-3";`);
});

it('inlines a mark called through an export webpack shortened', {
    timeout: WEBPACK_TEST_TIMEOUT_MS,
}, async () => {
    // A module webpack does not concatenate keeps its own scope, and production
    // `mangleExports` shortens its export names: the call is written
    // `(0,ns/* .__szCss */ .$t)(…)`. A shared chunk is the usual reason, as in
    // a Next client build; `concatenateModules: false` forces the same shape.
    const root = mkdtempSync(join(tmpdir(), 'csszyx-webpack-mark-shortened-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(
        join(root, 'src/index.js'),
        "import './style.css';\nimport { __szCss } from './rt.js';\nglobalThis.y = /*#__PURE__*/__szCss(\"m-3\");\n",
    );
    writeFileSync(
        join(root, 'src/rt.js'),
        'export function __szCss(classes) { return classes; }\n',
    );
    writeFileSync(join(root, 'src/App.tsx'), 'export const App = () => <div sz={{ m: 3 }} />;');
    writeFileSync(join(root, 'src/style.css'), '.m-3 { margin: 0.75rem; }');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
        await runWebpack(root, { emitManifest: true }, [], {
            concatenateModules: false,
            minimize: false,
        });
        const map = JSON.parse(readFileSync(join(root, 'dist/csszyx-manifest.json'), 'utf8')) as {
            mangleMap?: Record<string, string>;
        };
        const token = map.mangleMap?.['m-3'];
        expect(token).toBeTruthy();
        const bundle = readFileSync(join(root, 'dist/bundle.js'), 'utf8');
        expect(bundle.match(/globalThis\.y = [^;\n]*/)?.[0]).toBe(`globalThis.y = "${token}"`);
        expect(bundle).not.toMatch(/__szCss \*\/ \.[\w$]+\)\(/);
        const missed = warn.mock.calls.filter(call =>
            String(call[0]).includes('mangle-mark-missed'),
        );
        expect(missed).toEqual([]);
    } finally {
        warn.mockRestore();
    }
});

it.each([
    ['a syntax error', new CssSyntaxError('unfinished stylesheet'), false],
    ['an unexpected error', new Error('mangler unavailable'), true],
] as const)(
    'handles %s from the CSS output pass',
    { timeout: WEBPACK_TEST_TIMEOUT_MS },
    async (_name, failure, fatal) => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-webpack-mangle-failure-'));
        tempDirs.push(root);
        mkdirSync(join(root, 'src'));
        writeFileSync(join(root, 'src/index.js'), "import './style.css';");
        writeFileSync(join(root, 'src/App.tsx'), 'export const App = () => <div sz={{ m: 3 }} />;');
        const css = '.m-3 { margin: 0.75rem; }';
        writeFileSync(join(root, 'src/style.css'), css);
        vi.mocked(mangleCSSSync).mockImplementation(() => {
            throw failure;
        });
        if (fatal) {
            await expect(runWebpack(root)).rejects.toThrow('mangler unavailable');
        } else {
            await runWebpack(root);
            expect(readFileSync(join(root, 'dist/assets/style.css'), 'utf8')).toBe(css);
        }
        expect(mangleCSSSync).toHaveBeenCalled();
    },
);
