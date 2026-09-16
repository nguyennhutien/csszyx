import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { getNativePackageName, loadNativeBinding } from '@csszyx/core/native';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { RESOLVED_VIRTUAL_MODULE_ID } from '../src/virtual-modules.js';

type TransformHook = {
    load?: (id: string) => unknown;
    transform: (this: { warn: (message: string) => void }, code: string, id: string) => unknown;
};

type GenerateBundleHook = {
    generateBundle: (
        this: { emitFile: (asset: unknown) => void },
        options: unknown,
        bundle: Record<string, unknown>,
    ) => void;
};

const ORIGINAL_ENV = process.env.CSSZYX_PARSER;
const ORIGINAL_VAR_MAP_MAX_BYTES = process.env.CSSZYX_VAR_MANGLE_MAP_MAX_BYTES;
const tempDirs: string[] = [];

// The Rust parser branch needs the host platform's optional native package to
// contain a built addon before the unplugin can dispatch to it. CI should run
// `pnpm --filter @csszyx/core native:build -- --native-engine` ahead of these
// tests so this suite exercises the real install-style package-name path. When
// the addon is missing, the rust-mode tests assert the documented
// unavailable-error contract instead.
let nativeRustAvailable = false;

beforeAll(() => {
    const packageName = getNativePackageName();
    try {
        loadNativeBinding(packageName);
        nativeRustAvailable = true;
    } catch {
        nativeRustAvailable = false;
    }
});

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
    if (ORIGINAL_ENV === undefined) {
        delete process.env.CSSZYX_PARSER;
    } else {
        process.env.CSSZYX_PARSER = ORIGINAL_ENV;
    }
    if (ORIGINAL_VAR_MAP_MAX_BYTES === undefined) {
        delete process.env.CSSZYX_VAR_MANGLE_MAP_MAX_BYTES;
    } else {
        process.env.CSSZYX_VAR_MANGLE_MAP_MAX_BYTES = ORIGINAL_VAR_MAP_MAX_BYTES;
    }
});

/**
 * Create plugins and start them the way a bundler does before its first
 * transform: the build reads the project's stylesheets at build start, and the
 * engine refuses a transform that came first.
 *
 * The root is an empty directory, so no stylesheet on disk changes what these
 * tests measure.
 *
 * @param create - Builds the plugin array under test.
 * @returns The same plugins, started.
 */
async function started<T>(create: () => T): Promise<T> {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-parser-option-'));
    tempDirs.push(root);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    const plugins = create();
    cwd.mockRestore();
    await (plugins as unknown as Array<{ buildStart?: () => Promise<void> }>)[0]?.buildStart?.();
    return plugins;
}

describe('csszyx parser selection', () => {
    it('rejects unsupported global variable alias modes before transform', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: false,
                        mode: 'rename',
                    },
                },
            } as never),
        ).toThrow("production.mangleGlobalVars.mode only supports 'alias'");
    });

    it('rejects enabled global variable alias config without explicit tokens', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: true,
                        mode: 'alias',
                        onUnsafeUsage: 'error',
                    },
                },
            }),
        ).toThrow('production.mangleGlobalVars.enabled requires explicit tokens');
    });

    it('rejects enabled global variable autoPrefix until CSS pre-scan support exists', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: true,
                        tokens: ['--brand-primary'],
                        autoPrefix: '--brand-',
                    },
                },
            }),
        ).toThrow('production.mangleGlobalVars.autoPrefix is not available');
    });

    it('threads explicit global variable aliases into source transforms', async () => {
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: {
                    mangleGlobalVars: {
                        enabled: true,
                        tokens: ['--brand-primary'],
                    },
                },
            }),
        )) as TransformHook[];

        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            "const App = () => <div sz={{ bg: '--brand-primary' }} />;",
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('className="bg-(---gz)"');
        expect(result.code).not.toContain('bg-(--brand-primary)');
    });

    it('rewrites CSS assets with the validated explicit global variable alias plan', async () => {
        const [prePlugin, , postPlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: {
                    mangleGlobalVars: {
                        enabled: true,
                        tokens: ['--brand-primary'],
                    },
                },
            }),
        )) as [TransformHook, unknown, GenerateBundleHook];
        prePlugin.transform.call(
            { warn: vi.fn() },
            "const App = () => <div sz={{ bg: '--brand-primary' }} />;",
            '/repo/src/App.tsx',
        );
        const bundle = {
            'assets/app.css': {
                type: 'asset',
                fileName: 'assets/app.css',
                source: ':root{--brand-primary:red}.card{color:var(--brand-primary)}',
            },
        };

        postPlugin.generateBundle.call({ emitFile: vi.fn() }, {}, bundle);

        const css = String((bundle['assets/app.css'] as { source: string }).source);
        expect(css).toContain('---gz:var(--brand-primary)');
        expect(css).toContain('color:var(---gz)');
    });

    it('fails closed when explicit global variable tokens are missing from emitted CSS', async () => {
        const [, , postPlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: {
                    mangleGlobalVars: {
                        enabled: true,
                        tokens: ['--brand-primary'],
                    },
                },
            }),
        )) as [TransformHook, unknown, GenerateBundleHook];

        expect(() =>
            postPlugin.generateBundle.call(
                { emitFile: vi.fn() },
                {},
                {
                    'assets/app.css': {
                        type: 'asset',
                        fileName: 'assets/app.css',
                        source: '.card{color:red}',
                    },
                },
            ),
        ).toThrow('Global variable token --brand-primary is not defined in scanned CSS');
    });

    it('accepts explicit tokens defined by configured scanCss sources', async () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-global-var-scan-css-'));
        tempDirs.push(root);
        const cssPath = join(root, 'tokens.css');
        writeFileSync(cssPath, ':root{--brand-primary:red}.card{color:var(--brand-primary)}');
        const [, , postPlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false, scanCss: cssPath },
                production: {
                    mangleGlobalVars: {
                        enabled: true,
                        tokens: ['--brand-primary'],
                    },
                },
            }),
        )) as [TransformHook, unknown, GenerateBundleHook];
        const emitFile = vi.fn();

        expect(() =>
            postPlugin.generateBundle.call(
                { emitFile },
                {},
                {
                    'assets/app.css': {
                        type: 'asset',
                        fileName: 'assets/app.css',
                        source: '.card{color:red}',
                    },
                },
            ),
        ).not.toThrow();

        expect(emitFile).toHaveBeenCalledWith(
            expect.objectContaining({
                fileName: '.csszyx/global-var-map.json',
                source: '{"--brand-primary":"---gz"}',
            }),
        );
    });

    it('reads a stylesheet listed in scanCss and emitted by the bundle only once', async () => {
        // The configured sources and the bundle's assets are concatenated
        // before validation, so a stylesheet that is both is present twice.
        // Reading it twice would let a single definition satisfy a duplicate
        // check, and would report any conflict inside it against itself.
        const root = mkdtempSync(join(tmpdir(), 'csszyx-global-var-dupe-'));
        tempDirs.push(root);
        const cssPath = join(root, 'assets/app.css');
        mkdirSync(dirname(cssPath), { recursive: true });
        writeFileSync(cssPath, ':root{--brand-primary:red}.card{color:var(--brand-primary)}');
        const [, , postPlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false, scanCss: cssPath },
                production: {
                    mangleGlobalVars: { enabled: true, tokens: ['--brand-primary'] },
                },
            }),
        )) as [TransformHook, unknown, GenerateBundleHook];
        const emitFile = vi.fn();

        expect(() =>
            postPlugin.generateBundle.call(
                { emitFile },
                {},
                {
                    'assets/app.css': {
                        type: 'asset',
                        fileName: cssPath,
                        source: ':root{--brand-primary:red}.card{color:var(--brand-primary)}',
                    },
                },
            ),
        ).not.toThrow();

        expect(emitFile).toHaveBeenCalledWith(
            expect.objectContaining({
                fileName: '.csszyx/global-var-map.json',
                source: '{"--brand-primary":"---gz"}',
            }),
        );
    });

    it('can skip the standalone global variable map asset', async () => {
        const [prePlugin, , postPlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: {
                    mangleGlobalVars: {
                        enabled: true,
                        emitMap: false,
                        tokens: ['--brand-primary'],
                    },
                },
            }),
        )) as [TransformHook, unknown, GenerateBundleHook];
        prePlugin.transform.call(
            { warn: vi.fn() },
            "const App = () => <div sz={{ bg: '--brand-primary' }} />;",
            '/repo/src/App.tsx',
        );
        const emitFile = vi.fn();
        const bundle = {
            'assets/app.css': {
                type: 'asset',
                fileName: 'assets/app.css',
                source: ':root{--brand-primary:red}.card{color:var(--brand-primary)}',
            },
        };

        postPlugin.generateBundle.call({ emitFile }, {}, bundle);

        const emittedAssets = emitFile.mock.calls.map(([asset]) => asset);
        expect(emittedAssets).toContainEqual(
            expect.objectContaining({
                fileName: 'csszyx-manifest.json',
                source: expect.stringContaining('"globalVarAliases":{"--brand-primary":"---gz"}'),
            }),
        );
        expect(emittedAssets).not.toContainEqual(
            expect.objectContaining({ fileName: '.csszyx/global-var-map.json' }),
        );
    });

    it('rejects Tailwind reserved global variable alias tokens before the Phase H gate', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: false,
                        tokens: ['--color-primary'],
                    },
                },
            }),
        ).toThrow(
            'production.mangleGlobalVars.tokens cannot include Tailwind reserved namespace token "--color-primary"',
        );
    });

    it('rejects Tailwind reserved global variable autoPrefix before the Phase H gate', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: false,
                        autoPrefix: '--spacing-',
                    },
                },
            }),
        ).toThrow(
            'production.mangleGlobalVars.autoPrefix cannot target Tailwind reserved namespace "--spacing-"',
        );
    });

    it('allows common --g app tokens outside the active generated alias prefix', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: false,
                        tokens: ['--gap'],
                    },
                },
            }),
        ).not.toThrow();
    });

    it('rejects csszyx reserved global variable alias tokens before the Phase H gate', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: false,
                        tokens: ['---g-token'],
                    },
                },
            }),
        ).toThrow(
            'production.mangleGlobalVars.tokens cannot include csszyx reserved namespace token "---g-token"',
        );
    });

    it('rejects csszyx reserved global variable autoPrefix before the Phase H gate', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: false,
                        autoPrefix: '---g',
                    },
                },
            }),
        ).toThrow(
            'production.mangleGlobalVars.autoPrefix cannot target csszyx reserved namespace "---g*"',
        );
    });

    it('rejects invalid global variable aliasPrefix before the Phase H gate', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: false,
                        aliasPrefix: 'zg',
                    },
                },
            }),
        ).toThrow('production.mangleGlobalVars.aliasPrefix must be non-empty and start with "--"');
    });

    it('rejects Tailwind and overlapping global variable aliasPrefix config', () => {
        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: false,
                        aliasPrefix: '--color-',
                    },
                },
            }),
        ).toThrow(
            'production.mangleGlobalVars.aliasPrefix cannot target Tailwind reserved namespace "--color-"',
        );

        expect(() =>
            vitePlugin({
                production: {
                    mangleGlobalVars: {
                        enabled: false,
                        autoPrefix: '--brand-',
                        aliasPrefix: '--brand-zg',
                    },
                },
            }),
        ).toThrow(
            'production.mangleGlobalVars.aliasPrefix "--brand-zg" must not overlap autoPrefix "--brand-"',
        );
    });

    it('uses the native engine by default', async () => {
        const [prePlugin] = (await started(() => vitePlugin())) as TransformHook[];
        const warn = vi.fn();
        const result = prePlugin.transform.call(
            { warn },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App=()=>');
        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
        expect(warn).not.toHaveBeenCalled();
    });

    it('lets build.parser opt into the wasm build explicitly', async () => {
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { parser: 'wasm' },
            }),
        )) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App=()=>');
        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
    });

    it('lets CSSZYX_PARSER=wasm override build.parser=rust', async () => {
        process.env.CSSZYX_PARSER = 'wasm';
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { parser: 'rust' },
            }),
        )) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('const App=()=>');
        expect(result.code).toContain('className="p-4"');
    });

    it('passes production.mangleVars into the wasm compiler path', async () => {
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: { mangleVars: true },
            }),
        )) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('<section style={{"--cz": __szSpacingVar(pad, "p")}}>');
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
    });

    it('passes production.mangleVarHoistMaxDepth into the wasm compiler path', async () => {
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: { mangleVars: true, mangleVarHoistMaxDepth: 1 },
            }),
        )) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <section><div><span sz={{ p: pad }} /></div><button sz={{ p: pad }} /></section>;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).not.toContain('<section style={{"--cz"');
        expect(result.code).toContain(
            '<span className="p-(--sz)" style={{"--sz": __szSpacingVar(pad, "p")}} />',
        );
        expect(result.code).toContain(
            '<button className="p-(--sz)" style={{"--sz": __szSpacingVar(pad, "p")}} />',
        );
    });

    it('preserves mixed scoped and hoisted CSS variable tiers in runtime metadata', async () => {
        const [prePlugin, , postPlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: { mangleVars: true },
            }),
        )) as [TransformHook, unknown, GenerateBundleHook];
        const source =
            'const App = ({ pad, gap }) => <main><section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section><aside sz={{ p: gap }} /></main>;';

        prePlugin.transform.call({ warn: vi.fn() }, source, '/repo/src/App.tsx');
        const moduleSource = String(prePlugin.load?.(RESOLVED_VIRTUAL_MODULE_ID));

        expect(moduleSource).toContain('"--_sz-p": [');
        expect(moduleSource).toContain('"--cz"');
        expect(moduleSource).toContain('"--sz"');

        const emitted: Array<{ fileName: string; source: string }> = [];
        postPlugin.generateBundle.call(
            { emitFile: asset => emitted.push(asset as { fileName: string; source: string }) },
            {},
            {},
        );
        const manifestAsset = emitted.find(asset => asset.fileName === 'csszyx-manifest.json');
        expect(manifestAsset).toBeDefined();
        const manifest = JSON.parse(manifestAsset?.source ?? '{}') as {
            cssVarMetrics?: { componentClassUses: number; scopedClassUses: number };
        };
        expect(manifest.cssVarMetrics?.componentClassUses).toBe(2);
        expect(manifest.cssVarMetrics?.scopedClassUses).toBe(1);
    });

    it('replaces per-file CSS variable metadata instead of append-only accumulation', async () => {
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: { mangleVars: true },
            }),
        )) as TransformHook[];

        prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <div sz={{ p: pad }} />;',
            '/repo/src/App.tsx',
        );
        prePlugin.transform.call(
            { warn: vi.fn() },
            'const Card = ({ gap }) => <div sz={{ gap }} />;',
            '/repo/src/Card.tsx',
        );
        const initialModuleSource = String(prePlugin.load?.(RESOLVED_VIRTUAL_MODULE_ID));
        expect(initialModuleSource).toContain('"--_sz-p": "--sz"');
        expect(initialModuleSource).toContain('"--_sz-gap": "--sz"');

        prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = () => <div />;',
            '/repo/src/App.tsx',
        );
        const moduleSource = String(prePlugin.load?.(RESOLVED_VIRTUAL_MODULE_ID));

        expect(moduleSource).not.toContain('"--_sz-p"');
        expect(moduleSource).toContain('"--_sz-gap": "--sz"');
    });

    it('fails loudly when CSS variable metadata exceeds the safety cap', async () => {
        process.env.CSSZYX_VAR_MANGLE_MAP_MAX_BYTES = '16';
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: { mangleVars: true },
            }),
        )) as TransformHook[];

        prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <div sz={{ p: pad }} />;',
            '/repo/src/App.tsx',
        );

        expect(() => prePlugin.load?.(RESOLVED_VIRTUAL_MODULE_ID)).toThrow(
            'CSS variable mangle map',
        );
    });

    it('exposes CSS variable hoisting efficacy metrics', async () => {
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'wasm', cache: false },
                production: { mangleVars: true },
            }),
        )) as TransformHook[];

        prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;',
            '/repo/src/App.tsx',
        );
        const moduleSource = String(prePlugin.load?.(RESOLVED_VIRTUAL_MODULE_ID));

        expect(moduleSource).toContain('"componentClassUses": 2');
        expect(moduleSource).toContain('"componentStyleDeclarations": 1');
        expect(moduleSource).toContain('"estimatedHoistedDeclarationsSaved": 1');
    });

    it('passes production.mangleVars into the Rust compiler path', async () => {
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { emitManifest: true, parser: 'rust', cache: false },
                production: { mangleVars: true },
            }),
        )) as TransformHook[];

        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App = ({ pad }) => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('<section style={{"--cz": __szSpacingVar(pad, "p")}}>');
        expect(result.code).toContain('<div className="p-(--cz)" />');
        expect(result.code).toContain('<span className="p-(--cz)" />');
    });

    it('lets build.parser opt into the Rust engine explicitly', async () => {
        if (!nativeRustAvailable) {
            // No host addon present — assert the explicit unavailable-error
            // contract so users hitting this path know the parser flipped on
            // but the binding is missing for their platform.
            const [prePlugin] = (await started(() =>
                vitePlugin({
                    build: { parser: 'rust' },
                }),
            )) as TransformHook[];
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'const App=()=> <div sz={{ p: 4 }} />;',
                    '/repo/src/App.tsx',
                ),
            ).toThrow('Use build.parser: "wasm" or "auto"');
            return;
        }

        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { parser: 'rust' },
            }),
        )) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
    });

    it('injects runtime imports when the rust engine emits fallback helpers', async () => {
        if (!nativeRustAvailable) {
            const [prePlugin] = (await started(() =>
                vitePlugin({
                    build: { parser: 'rust' },
                }),
            )) as TransformHook[];
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'export const App = () => <div sz={{ p: 4 }} />;',
                    '/repo/src/App.tsx',
                ),
            ).toThrow('Use build.parser: "wasm" or "auto"');
            return;
        }

        // Conditional spread is the canonical R4.5 shape: the Rust engine
        // emits `className={_sz(<original>)}` and flips usesRuntime=true.
        // The unplugin's runtime-helpers pass must read that flag and add
        // the matching `_sz` import from @csszyx/runtime — without it the
        // emitted code references an undefined symbol at runtime, which
        // is the kind of silent end-to-end break that's invisible to
        // unit tests on either side of the boundary.
        const source = [
            'const BASE = { p: 4 } as const;',
            'export const App = ({ big }: { big: boolean }) =>',
            '    <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;',
            'export const Runtime = ({ styles }) => <div sz={styles} />;',
            'export const MergeRuntime = ({ styles }) => <div className="existing" sz={styles} />;',
            'export const MergeDynamic = ({ styles }) => <div className={getClass()} sz={styles} />;',
        ].join('\n');
        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { parser: 'rust' },
            }),
        )) as TransformHook[];

        const result = prePlugin.transform.call({ warn: vi.fn() }, source, '/repo/src/App.tsx') as {
            code: string;
        };

        expect(result.code).toContain('_sz({ ...BASE, ...(big ? { p: 8 } : {}) })');
        expect(result.code).toContain('_sz(styles)');
        expect(result.code).toContain('_szMerge("existing", _sz(styles))');
        expect(result.code).toContain('_szMerge(getClass(), _sz(styles))');
        expect(result.code).toMatch(
            /import\s+\{[^}]*\b_sz\b[^}]*\}\s+from\s+['"]@csszyx\/runtime['"]/,
        );
        expect(result.code).toMatch(
            /import\s+\{[^}]*\b_szMerge\b[^}]*\}\s+from\s+['"]@csszyx\/runtime['"]/,
        );
    });

    it('lets CSSZYX_PARSER=rust override build.parser=wasm', async () => {
        process.env.CSSZYX_PARSER = 'rust';

        if (!nativeRustAvailable) {
            const [prePlugin] = (await started(() =>
                vitePlugin({
                    build: { parser: 'wasm' },
                }),
            )) as TransformHook[];
            expect(() =>
                prePlugin.transform.call(
                    { warn: vi.fn() },
                    'const App=()=> <div sz={{ p: 4 }} />;',
                    '/repo/src/App.tsx',
                ),
            ).toThrow('build.parser: "wasm"');
            return;
        }

        const [prePlugin] = (await started(() =>
            vitePlugin({
                build: { parser: 'wasm' },
            }),
        )) as TransformHook[];
        const result = prePlugin.transform.call(
            { warn: vi.fn() },
            'const App=()=> <div sz={{ p: 4 }} />;',
            '/repo/src/App.tsx',
        ) as { code: string };

        expect(result.code).toContain('className="p-4"');
        expect(result.code).not.toContain(' sz=');
    });
});
