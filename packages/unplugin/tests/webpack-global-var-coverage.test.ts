/**
 * The webpack asset pass against a compiler that records its hooks instead of
 * running a real build.
 *
 * A real webpack always carries `compiler.webpack` and hands every asset a
 * string or a Buffer, so the fallbacks for an older or wrapped compiler, and
 * for an asset whose `source()` is neither, never run there. The CSS-variable
 * map and metrics come from the same prescan a real build runs, over a project
 * written to a temporary directory.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PartialCsszyxConfig } from '../src/index.js';
import { webpackPlugin } from '../src/unplugin.js';

const roots: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** One callback registered on a compiler hook. */
interface Tap {
    name: string;
    fn: (...args: unknown[]) => unknown;
}

/** Asset as the plugin reads it: only `source()` is called. */
interface FakeAsset {
    source: () => unknown;
}

/** Stand-in for `webpack.sources.RawSource`. */
class RawSource {
    constructor(private readonly text: string) {}

    source(): string {
        return this.text;
    }
}

/** The `compiler.webpack` namespace a webpack 5 compiler carries. */
const WEBPACK_NAMESPACE = {
    Compilation: { PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: 2500 },
    sources: { RawSource },
    WebpackError: Error,
};

/**
 * Prototype of a compilation whose class carries the stage, as webpack's own
 * `Compilation` does: `compilation.constructor` resolves to it.
 */
const STAGED_COMPILATION = { constructor: { PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE: 1234 } };

/** Result of applying the plugin to a recording compiler. */
interface AppliedPlugin {
    /** Stage the post plugin passed to `processAssets.tap`. */
    stage: unknown;
    /** Runs the post plugin's asset pass; returns the emitted assets by name. */
    processAssets: (assets: Record<string, FakeAsset>) => Map<string, string>;
}

/**
 * Writes a project, applies the combined webpack plugin to a compiler that
 * records every tap, runs `beforeCompile` (the prescan), and opens one
 * compilation.
 *
 * @param options Project files, plugin options and the compiler shape.
 * @param options.files Project-relative path to file contents.
 * @param options.config Plugin options.
 * @param options.webpackNamespace `compiler.webpack`, or undefined for none.
 * @param options.compilationPrototype Prototype of the fake compilation.
 * @returns The registered stage and a runner for the asset pass.
 */
async function applyPlugin(options: {
    files?: Record<string, string>;
    config: PartialCsszyxConfig;
    webpackNamespace?: typeof WEBPACK_NAMESPACE;
    compilationPrototype?: object;
}): Promise<AppliedPlugin> {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-webpack-cov-')));
    roots.push(root);
    for (const [file, content] of Object.entries(options.files ?? {})) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
    }
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const taps = new Map<string, Tap[]>();
    const hook = (hookName: string) => {
        const add = (name: string, fn: Tap['fn']): void => {
            taps.set(hookName, [...(taps.get(hookName) ?? []), { name, fn }]);
        };
        return { tap: add, tapPromise: add, tapAsync: add };
    };
    const compiler = {
        context: root,
        webpack: options.webpackNamespace,
        options: { mode: 'production', plugins: [], resolve: {}, module: { rules: [] } },
        hooks: new Proxy({}, { get: (_target, key) => hook(String(key)) }),
    };

    webpackPlugin(options.config).apply(compiler as never);
    for (const tap of taps.get('beforeCompile') ?? []) await tap.fn({});

    const emitted = new Map<string, string>();
    let stage: unknown;
    let run: ((assets: Record<string, FakeAsset>) => void) | undefined;
    const compilation = Object.assign(Object.create(options.compilationPrototype ?? {}), {
        hooks: {
            processAssets: {
                tap: (tapOptions: { stage: unknown }, fn: typeof run) => {
                    stage = tapOptions.stage;
                    run = fn;
                },
            },
        },
        emitAsset: (name: string, source: RawSource) => emitted.set(name, source.source()),
        updateAsset: (name: string, source: RawSource) => emitted.set(name, source.source()),
    });
    for (const tap of taps.get('compilation') ?? []) {
        if (tap.name === 'csszyx:post') tap.fn(compilation);
    }

    return {
        stage,
        processAssets: assets => {
            run?.(assets);
            return emitted;
        },
    };
}

/**
 * Reads the manifest the asset pass emitted.
 *
 * @param emitted Emitted assets by name.
 * @returns Parsed manifest.
 */
function manifestOf(emitted: Map<string, string>): {
    varMangleMap?: Record<string, string | string[]>;
    globalVarAliases?: Record<string, string>;
    cssVarMetrics?: Record<string, number>;
} {
    return JSON.parse(emitted.get('csszyx-manifest.json') ?? '{}');
}

const GLOBAL_VAR_CONFIG: PartialCsszyxConfig = {
    build: { emitManifest: true, cache: false },
    production: {
        mangle: false,
        mangleGlobalVars: { enabled: true, tokens: ['--brand-primary'] },
    },
};

const BRAND_CSS = ':root{--brand-primary:red}.card{color:var(--brand-primary)}';

describe('webpack processAssets stage', () => {
    const config: PartialCsszyxConfig = { build: { cache: false }, production: { mangle: false } };

    it('takes the stage from compiler.webpack when the compiler carries it', async () => {
        const applied = await applyPlugin({ config, webpackNamespace: WEBPACK_NAMESPACE });

        expect(applied.stage).toBe(2500);
    });

    it("reads the compilation's own class when the compiler has no webpack namespace", async () => {
        const applied = await applyPlugin({
            config,
            compilationPrototype: STAGED_COMPILATION,
        });

        expect(applied.stage).toBe(1234);
    });

    it('falls back to stage 400 when neither the compiler nor the compilation has one', async () => {
        const applied = await applyPlugin({ config });

        expect(applied.stage).toBe(400);
    });
});

describe('webpack global-var validation over CSS assets', () => {
    it('validates a CSS asset whose source is a string', async () => {
        const applied = await applyPlugin({
            config: GLOBAL_VAR_CONFIG,
            webpackNamespace: WEBPACK_NAMESPACE,
        });

        const emitted = applied.processAssets({ 'style.css': { source: () => BRAND_CSS } });

        expect(manifestOf(emitted).globalVarAliases).toEqual({ '--brand-primary': '---gz' });
    });

    it('leaves out a CSS asset whose source is neither a string nor bytes', async () => {
        const applied = await applyPlugin({
            config: GLOBAL_VAR_CONFIG,
            webpackNamespace: WEBPACK_NAMESPACE,
        });

        // The same text, boxed: `toString()` still yields it, but it is not
        // one of the two shapes the scan reads, so the definition is unseen.
        expect(() =>
            applied.processAssets({
                'style.css': { source: () => new String(BRAND_CSS) },
            }),
        ).toThrow('Global variable token --brand-primary is not defined in scanned CSS');
    });

    it('names where a token that cannot be aliased is defined', async () => {
        const applied = await applyPlugin({
            config: GLOBAL_VAR_CONFIG,
            webpackNamespace: WEBPACK_NAMESPACE,
        });

        expect(() =>
            applied.processAssets({
                'theme.css': { source: () => '@theme{\n  --brand-primary:red;\n}' },
            }),
        ).toThrow(/\[tailwind-owned\] --brand-primary \(\S*theme\.css:2:3\): .*inside @theme/);
    });
});

describe('webpack manifest CSS-variable data', () => {
    const config: PartialCsszyxConfig = {
        build: { emitManifest: true, cache: false },
        production: { mangle: false, mangleVars: true },
    };

    it('lists every distinct name one generated variable was given across files', async () => {
        const applied = await applyPlugin({
            config,
            webpackNamespace: WEBPACK_NAMESPACE,
            files: {
                // `p` hoisted as the component's first variable: `--cz`.
                'src/a.tsx':
                    'export const A = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;\n',
                // `p` hoisted as the component's second variable: `--cy`.
                'src/b.tsx':
                    'export const B = ({ pad, gap }) => <section><div sz={{ m: gap, p: pad }} /><span sz={{ m: gap, p: pad }} /></section>;\n',
                // `p` on a single element stays scoped: `--sz`.
                'src/c.tsx': 'export const C = ({ pad }) => <div sz={{ p: pad }} />;\n',
            },
        });

        const manifest = manifestOf(applied.processAssets({}));

        expect(manifest.varMangleMap?.['--_sz-p']).toEqual(['--cz', '--cy', '--sz']);
    });

    it('counts a component variable used with no declaration in its file as saved', async () => {
        const applied = await applyPlugin({
            config,
            webpackNamespace: WEBPACK_NAMESPACE,
            files: {
                'src/d.tsx':
                    'export const D = ({ pad }) => <div sz={{ p: pad }} />;\nexport const used = "(--cq)";\n',
            },
        });

        const manifest = manifestOf(applied.processAssets({}));

        expect(manifest.cssVarMetrics).toMatchObject({
            componentClassUses: 1,
            componentStyleDeclarations: 0,
            estimatedHoistedDeclarationsSaved: 1,
        });
    });
});
