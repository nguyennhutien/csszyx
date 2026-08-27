/**
 * Unit net for the self-installing runtime mangle-map module.
 *
 * The module is generated source that executes in the app bundle, so these
 * tests run the generated code in a sandboxed context and assert what it hands
 * to `installMangleRuntime`: the final map through placeholders, and the debug
 * opt-in the build configured.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { vitePlugin } from '../src/unplugin.js';
import {
    CHECKSUM_PLACEHOLDER,
    createMangleRuntimeModule,
    isVirtualModule,
    MANGLE_MAP_PLACEHOLDER,
    MANGLE_RUNTIME_VIRTUAL_ID,
    RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID,
    resolveVirtualModule,
    VAR_MANGLE_MAP_PLACEHOLDER,
} from '../src/virtual-modules.js';
import { executableInlineScripts } from './executable-inline-scripts.js';
import { freshFixtureRoot } from './fixture-root.js';

const MAP = { 'flex-col': 'm7', 'mx-0': 'z' };
const VAR_MAP = { '--_sz-a': ['v1', 'v2'], '--_sz-b': 'v3' };

/** What the generated module hands to `installMangleRuntime`. */
interface InstallInput {
    mangleMap: Record<string, string>;
    varMangleMap: Record<string, string | string[]>;
    checksum: string;
    globalVarAliasPrefix: string;
    exposeDebugGlobal: boolean;
}

/**
 * Substitute the placeholders the way output processing does, then execute the
 * generated module body against a stub `installMangleRuntime`.
 *
 * @param prefix - Global CSS variable alias prefix baked into the module.
 * @param exposeDebugGlobal - Whether the module asks for `window.__csszyx`.
 * @returns The argument the module passed to the installer.
 */
function runModule(prefix: string, exposeDebugGlobal?: boolean): InstallInput | undefined {
    const source = createMangleRuntimeModule(prefix, exposeDebugGlobal)
        .split(MANGLE_MAP_PLACEHOLDER)
        .join(JSON.stringify(MAP))
        .split(VAR_MANGLE_MAP_PLACEHOLDER)
        .join(JSON.stringify(VAR_MAP))
        .split(CHECKSUM_PLACEHOLDER)
        .join('sum-1');
    let installed: InstallInput | undefined;
    const context = {
        installMangleRuntime: (input: InstallInput) => {
            installed = input;
        },
    };
    // The generated source is an ES module: one import, one call. Strip the
    // import so `vm` can run it as a script against the stub.
    const importLine = /^import \{ installMangleRuntime \} from '@csszyx\/runtime\/core';$/m;
    expect(source).toMatch(importLine);
    runInNewContext(source.replace(importLine, ''), context);
    return installed;
}

describe('createMangleRuntimeModule', () => {
    it('registers the final map through the runtime installer, not a window global', () => {
        const source = createMangleRuntimeModule('--app-');
        // Correctness goes through the registry inside @csszyx/runtime; the
        // module never touches `window` itself.
        expect(source).not.toContain('window');
        // Placeholders, not live values: substitution happens at output
        // processing, after the mangle passes.
        expect(source).toContain(MANGLE_MAP_PLACEHOLDER);
        expect(source).toContain(VAR_MANGLE_MAP_PLACEHOLDER);
        expect(source).toContain(CHECKSUM_PLACEHOLDER);
    });

    it('passes every input to installMangleRuntime', () => {
        expect(runModule('--app-')).toEqual({
            mangleMap: MAP,
            varMangleMap: VAR_MAP,
            checksum: 'sum-1',
            globalVarAliasPrefix: '--app-',
            exposeDebugGlobal: false,
        });
    });

    it('asks for the debug global only when the build opted in', () => {
        expect(runModule('--app-', true)?.exposeDebugGlobal).toBe(true);
        expect(runModule('--app-', false)?.exposeDebugGlobal).toBe(false);
    });

    it('resolves through the virtual module registry', () => {
        expect(isVirtualModule(MANGLE_RUNTIME_VIRTUAL_ID)).toBe(true);
        expect(resolveVirtualModule(MANGLE_RUNTIME_VIRTUAL_ID)).toBe(
            RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID,
        );
    });
});

describe('mangle-runtime import injection (plugin hooks)', () => {
    /**
     * Drive the pre-plugin's hooks directly, mirroring the other hook-level
     * suites.
     *
     * @param production - Extra production options merged over `mangle: true`.
     * @returns Hook caller bound to a fresh plugin instance.
     */
    function pluginHarness(production: Record<string, unknown> = {}) {
        const plugins = vitePlugin({ production: { mangle: true, ...production } });
        const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
        const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
            const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
            if (!plugin) return undefined;
            const hook = (plugin as Record<string, unknown>)[hookName];
            const fn = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as ((...a: unknown[]) => unknown) | undefined;
            return fn ? await fn.apply(ctx, args) : undefined;
        };
        const root = freshFixtureRoot('mangle-runtime-inject');
        return { call, root };
    }

    const RUNTIME_CONSUMER = `import { szr } from '@csszyx/runtime';\nexport const c = szr({ p: 4 });\n`;

    it('injects exactly once, and never twice on an already-injected module', async () => {
        const { call, root } = pluginHarness();
        await call('configResolved', { root, command: 'build' });

        const first = (await call('transform', RUNTIME_CONSUMER, `${root}/src/a.ts`)) as {
            code?: string;
        } | null;
        const occurrences = (code: string): number =>
            code.split(MANGLE_RUNTIME_VIRTUAL_ID).length - 1;
        expect(first?.code, 'consumer must receive the import').toBeDefined();
        expect(occurrences(first?.code ?? '')).toBe(1);

        // Feed the already-injected output back through: idempotent.
        const second = (await call('transform', first?.code ?? '', `${root}/src/a.ts`)) as {
            code?: string;
        } | null;
        expect(occurrences(second?.code ?? first?.code ?? '')).toBe(1);
    });

    it('injects the import into every processed runtime consumer', async () => {
        const { call, root } = pluginHarness();
        await call('configResolved', { root, command: 'build' });

        const out = (await call('transform', RUNTIME_CONSUMER, `${root}/src/a.ts`)) as {
            code?: string;
        } | null;
        expect(out?.code ?? '').toContain(MANGLE_RUNTIME_VIRTUAL_ID);
    });

    it('attaches the registration module to the HTML entry when a mangled build has a map', async () => {
        // Per-consumer injection only reaches modules the plugin processes; a
        // pre-compiled wrapper package under node_modules that imports the
        // runtime itself gets none. The HTML entry is the one guaranteed
        // ancestor of every module in the page, so the tag goes there — as
        // the first module script, which vite turns into the first import of
        // the entry, evaluated before the app and everything it imports.
        const { call, root } = pluginHarness();
        mkdirSync(resolve(root, 'src'), { recursive: true });
        writeFileSync(
            resolve(root, 'src/A.tsx'),
            'export const A = () => <div sz={{ p: 4 }} />;',
            'utf8',
        );
        await call('configResolved', { root, command: 'build' });
        await call('buildEnd');

        const out = (await call(
            'transformIndexHtml',
            '<html><head></head><body></body></html>',
        )) as {
            html: string;
            tags: { tag: string; attrs: Record<string, string>; injectTo: string }[];
        };
        expect(typeof out).toBe('object');
        expect(out.tags).toEqual([
            {
                tag: 'script',
                attrs: { type: 'module', src: MANGLE_RUNTIME_VIRTUAL_ID },
                injectTo: 'head-prepend',
            },
        ]);
        expect(out.html).toContain('__CSSZYX_MANGLE_MAP__');
        expect(executableInlineScripts(out.html)).toEqual([]);
    });

    it('attaches no module tag when the census is empty', async () => {
        const { call, root } = pluginHarness();
        await call('configResolved', { root, command: 'build' });
        await call('buildEnd');
        const out = await call('transformIndexHtml', '<html><head></head><body></body></html>');
        expect(typeof out).toBe('string');
    });

    it('does not inject in a dev server (mangling forced off)', async () => {
        const { call, root } = pluginHarness();
        await call('configResolved', { root, command: 'serve' });

        const out = (await call('transform', RUNTIME_CONSUMER, `${root}/src/a.ts`)) as {
            code?: string;
        } | null;
        expect(out?.code ?? RUNTIME_CONSUMER).not.toContain(MANGLE_RUNTIME_VIRTUAL_ID);
    });

    it('serves the placeholder module through the load hook', async () => {
        const { call, root } = pluginHarness();
        await call('configResolved', { root, command: 'build' });

        const loaded = (await call('load', RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID)) as string;
        expect(loaded).toContain('installMangleRuntime(');
        expect(loaded).toContain('exposeDebugGlobal: false');
        // Placeholders, not live values: substitution happens at output
        // processing, after the mangle passes.
        expect(loaded).toContain(MANGLE_MAP_PLACEHOLDER);
        expect(loaded).toContain(CHECKSUM_PLACEHOLDER);
    });
});
