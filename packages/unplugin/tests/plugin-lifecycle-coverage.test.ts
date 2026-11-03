/**
 * Plugin lifecycle paths a single build does not reach: the prefix a dev
 * server keeps when an edit leaves the stylesheets disagreeing, the engine
 * banner on a later instance, a transform-cache entry stored twice, and a
 * boolean key inside a runtime `_sz({...})` call reaching the safelist.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SAFELIST_FILE } from '../src/safelist-source.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const engineState = vi.hoisted(() => ({ rustAvailable: true }));
const compilerMock = vi.hoisted(() => ({ transformRustBatch: vi.fn() }));

vi.mock('@csszyx/compiler/engine', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/engine')>();
    return {
        ...actual,
        isRustTransformAvailable: () =>
            engineState.rustAvailable && actual.isRustTransformAvailable(),
    };
});

vi.mock('@csszyx/compiler/internal', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/internal')>();
    return {
        ...actual,
        // Delegates unless a case installs its own batch.
        transformRustBatchUnrendered: (
            files: Parameters<typeof actual.transformRustBatchUnrendered>[0],
            options: Parameters<typeof actual.transformRustBatchUnrendered>[1],
        ) =>
            compilerMock.transformRustBatch.getMockImplementation() === undefined
                ? actual.transformRustBatchUnrendered(files, options)
                : compilerMock.transformRustBatch(files, options),
    };
});

type Plugins = Record<string, unknown>[];

const tempDirs: string[] = [];

afterEach(() => {
    compilerMock.transformRustBatch.mockReset();
    engineState.rustAvailable = true;
    removeTailwindProjects();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * The plugin module as a new process loads it, with its once-per-process
 * flags unset.
 *
 * @returns The module's `vitePlugin`.
 */
async function freshVitePlugin(): Promise<typeof import('../src/unplugin.js').vitePlugin> {
    vi.resetModules();
    return (await import('../src/unplugin.js')).vitePlugin;
}

/**
 * Collect every `console.warn` line from here on.
 *
 * @returns The live list of lines.
 */
function recordWarnings(): string[] {
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
    });
    return warnings;
}

describe('a dev server whose stylesheets stop agreeing', () => {
    it('names the prefix it keeps, in backticks', async () => {
        const vitePlugin = await freshVitePlugin();
        const root = tailwindProject('csszyx-lifecycle-prefix-', {
            'src/index.css': '@import "tailwindcss" prefix(tw);\n',
            'src/App.tsx': 'export const App = () => <div sz={{ p: 4 }} />;\n',
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const warnings = recordWarnings();
        const call = callHooks(
            vitePlugin({ build: { cache: false }, production: { mangle: false } }) as Plugins,
        );
        await call('configResolved', { root, command: 'serve' });

        const legacy = join(root, 'legacy/old.css');
        mkdirSync(dirname(legacy), { recursive: true });
        writeFileSync(legacy, '@import "tailwindcss" prefix(old);\n', 'utf8');
        const graph = {
            getModuleById: () => null,
            invalidateModule() {},
            getModulesByFile: () => undefined,
            invalidateAll() {},
        };
        await call('hotUpdate', {
            type: 'update',
            file: legacy,
            modules: [],
            server: {
                config: { root },
                watcher: { emit() {} },
                ws: { send() {} },
                moduleGraph: graph,
                environments: { client: { moduleGraph: graph } },
            },
        });

        const kept = warnings.filter(line => line.startsWith('[csszyx] prefix-disagreement:'));
        expect(kept).toHaveLength(1);
        expect(kept[0]).toContain(
            'note: the dev server keeps the prefix it last read (`tw`) until the stylesheets agree again.',
        );
    }, 60_000);
});

describe('the engine banner', () => {
    /**
     * Run one module through an instance's transform hook, which announces
     * the engine in effect.
     *
     * @param plugins - The plugin objects one `vitePlugin` call returned.
     */
    function transformOnce(plugins: Plugins): void {
        const plugin = plugins.find(p => p && 'transform' in p);
        const hook = plugin?.transform;
        const transform = (
            typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
        ) as (this: unknown, code: string, id: string) => unknown;
        transform.call({ warn() {} }, 'export const x = 1;', '/p/App.tsx');
    }

    it('names no missing native engine when wasm was chosen', async () => {
        const vitePlugin = await freshVitePlugin();
        const warnings = recordWarnings();

        transformOnce(vitePlugin({ build: { cache: false, parser: 'wasm' } }) as Plugins);

        // The announcement ran: it named the engine, and nothing degraded.
        expect(warnings.some(line => line.startsWith('[csszyx] active-parser:'))).toBe(true);
        expect(warnings.join('\n')).not.toContain('native-engine-unavailable');
    });

    it('prints the degrade once per process, not once per instance', async () => {
        engineState.rustAvailable = false;
        const vitePlugin = await freshVitePlugin();
        const warnings = recordWarnings();
        transformOnce(vitePlugin({ build: { cache: false } }) as Plugins);
        expect(warnings.filter(line => line.includes('native-engine-unavailable'))).toHaveLength(1);

        warnings.length = 0;
        transformOnce(vitePlugin({ build: { cache: false } }) as Plugins);

        expect(warnings).toEqual([]);
    });
});

describe('a transform cache entry stored twice', () => {
    // A file reached from two nested `compileSources` entries is walked twice,
    // so one native batch carries it twice and its cache key is stored twice.
    // The second store must replace the first in the size account; counting
    // both would push the account past the budget and evict an unrelated
    // entry the next prescan needs.
    it('keeps the code-size account at one copy, so other entries stay cached', async () => {
        const vitePlugin = await freshVitePlugin();
        const base = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-lifecycle-cache-')));
        tempDirs.push(base);
        const root = join(base, 'app');
        const shared = join(base, 'shared');
        mkdirSync(join(root, 'src'), { recursive: true });
        mkdirSync(join(shared, 'ui'), { recursive: true });
        const bPath = join(root, 'src/B.tsx');
        const aPath = join(shared, 'ui/A.tsx');
        writeFileSync(bPath, 'export const B = () => <div sz={{ p: 4 }} />;\n', 'utf8');
        writeFileSync(aPath, 'export const A = () => <div sz={{ m: 2 }} />;\n', 'utf8');

        // Just over half the 32M-char budget: one copy fits beside B, two do not.
        const bigCode = `export const A = 1;/*${'x'.repeat(16_500_000)}*/`;
        const bCode = 'export const B = () => <div className="p-4" />;';
        compilerMock.transformRustBatch.mockImplementation(
            (files: Array<{ filename: string; source: string }>) =>
                files.map(file => ({
                    code: file.filename.endsWith('B.tsx') ? bCode : bigCode,
                    transformed: true,
                    usesRuntime: false,
                    usesMerge: false,
                    usesColorVar: false,
                    usesSpacingVar: false,
                    usesUnitVar: false,
                    classes: new Set([file.filename.endsWith('B.tsx') ? 'p-4' : 'm-2']),
                    rawClassNames: new Set(),
                    diagnostics: [],
                    recoveryTokens: new Map(),
                    cssVariableMap: new Map(),
                })),
        );
        const cacheDir = join(base, 'cache');
        const call = callHooks(
            vitePlugin({
                compileSources: [shared, join(shared, 'ui')],
                build: { parser: 'rust', cache: true, cacheDir },
                production: { mangle: false },
            }) as Plugins,
        );
        await call('configResolved', { root });

        expect(compilerMock.transformRustBatch).toHaveBeenCalledTimes(1);
        expect(
            compilerMock.transformRustBatch.mock.calls[0]?.[0].map(
                (file: { filename: string }) => file.filename,
            ),
        ).toEqual([bPath, aPath, aPath]);

        // Only the in-memory entries can answer the next prescan now: every
        // file is still there, so nothing goes back to the engine.
        rmSync(cacheDir, { recursive: true, force: true });
        await call('configResolved', { root });

        expect(compilerMock.transformRustBatch).toHaveBeenCalledTimes(1);
    }, 60_000);
});

describe('a boolean key in a runtime sz call', () => {
    it('reaches the safelist', async () => {
        const vitePlugin = await freshVitePlugin();
        const root = tailwindProject('csszyx-lifecycle-runtime-bool-', {
            'src/index.css': '@import "tailwindcss";\n',
            // A `_sz` call written in the module is code the engine passes
            // through: it reports no class for it, so only the runtime-call
            // collector can see `truncate`. The dynamic `sz` makes the module
            // a runtime user, which is what turns that collector on.
            'src/App.tsx':
                "import { _sz } from '@csszyx/runtime';\n" +
                'export const App = ({ rest, extra }) =>\n' +
                '    <div sz={rest} className={_sz({ truncate: true, ...extra })} />;\n',
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        recordWarnings();
        const call = callHooks(
            vitePlugin({ build: { cache: false }, production: { mangle: false } }) as Plugins,
        );

        await call('configResolved', { root });

        const safelist = readFileSync(join(root, SAFELIST_FILE), 'utf8').split('\n');
        expect(safelist).toContain('truncate');
    }, 60_000);
});
