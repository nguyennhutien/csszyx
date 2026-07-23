/**
 * Unit net for the self-installing runtime mangle-map module.
 *
 * The module is generated source that executes in the app bundle, so these
 * tests run the generated code in a sandboxed context and assert the install
 * contract: install only when absent, mirror the HTML script's object shape,
 * and stay inert without a `window`.
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { unplugin as rawInstance, vitePlugin } from '../src/unplugin.js';
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

interface InstalledRuntime {
    mangleMap: Record<string, string>;
    varMangleMap: Record<string, string | string[]>;
    checksum: string;
    decode: (token: string) => string | undefined;
    encode: (cls: string) => string | undefined;
    decodeVar: (token: string) => string[];
    encodeVar: (name: string) => string | string[] | undefined;
    decodeGlobalVar: (token: string) => string | undefined;
    decodeAll: (el: { className: string }) => string[];
}

const MAP = { 'flex-col': 'm7', 'mx-0': 'z' };
const VAR_MAP = { '--_sz-a': ['v1', 'v2'], '--_sz-b': 'v3' };

/**
 * Substitute the placeholders the way output processing does, then execute the
 * generated module body against a fake `window`.
 * @param prefix - Global CSS variable alias prefix baked into the module.
 * @param window - Fake window object; omit to simulate SSR (no window global).
 * @param window.__csszyx - Pre-existing runtime object, when present.
 * @param checksum - Value substituted for the checksum placeholder.
 * @returns The installed runtime object, when the module installed one.
 */
function runModule(
    prefix: string,
    window?: { __csszyx?: unknown },
    checksum = 'sum-1',
): InstalledRuntime | undefined {
    const source = createMangleRuntimeModule(prefix)
        .split(MANGLE_MAP_PLACEHOLDER)
        .join(JSON.stringify(MAP))
        .split(VAR_MANGLE_MAP_PLACEHOLDER)
        .join(JSON.stringify(VAR_MAP))
        .split(CHECKSUM_PLACEHOLDER)
        .join(checksum);
    const context: Record<string, unknown> = window === undefined ? {} : { window };
    // The generated source is an ES module whose only statement besides consts
    // is the guarded install; strip the export so `vm` can run it as a script.
    runInNewContext(source.replace('export {};', ''), context);
    return (window as { __csszyx?: InstalledRuntime } | undefined)?.__csszyx;
}

describe('createMangleRuntimeModule', () => {
    it('installs the full runtime object when no window object exists', () => {
        const window: { __csszyx?: unknown } = {};
        const runtime = runModule('--app-', window);

        expect(runtime).toBeDefined();
        expect(runtime?.mangleMap).toEqual(MAP);
        expect(runtime?.checksum).toBe('sum-1');
        expect(runtime?.encode('flex-col')).toBe('m7');
        expect(runtime?.decode('m7')).toBe('flex-col');
        expect(runtime?.decode('unknown')).toBeUndefined();
        expect(runtime?.decodeVar('v1')).toEqual(['--_sz-a']);
        expect(runtime?.decodeVar('v3')).toEqual(['--_sz-b']);
        expect(runtime?.encodeVar('--_sz-b')).toBe('v3');
        expect(runtime?.decodeAll({ className: 'm7 z keep' })).toEqual([
            'flex-col',
            'mx-0',
            'keep',
        ]);
    });

    it('never replaces an existing runtime object', () => {
        const existing = { checksum: 'html-script' };
        const window: { __csszyx?: unknown } = { __csszyx: existing };
        runModule('--app-', window, 'sum-2');

        expect(window.__csszyx).toBe(existing);
    });

    it('is inert without a window (SSR)', () => {
        expect(() => runModule('--app-', undefined, 'sum-3')).not.toThrow();
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
     * @returns Hook caller bound to a fresh plugin instance.
     */
    function pluginHarness() {
        const plugins = vitePlugin({ production: { mangle: true } });
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
        const root = resolve(homedir(), '.cache/csszyx-tests/mangle-runtime-inject');
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
        expect(loaded).toContain('window.__csszyx');
        // Placeholders, not live values: substitution happens at output
        // processing, after the mangle passes.
        expect(loaded).toContain(MANGLE_MAP_PLACEHOLDER);
        expect(loaded).toContain(CHECKSUM_PLACEHOLDER);
    });

    it('a webpack build never receives the module, in any mode', async () => {
        // Webpack parses the `virtual:` specifier's colon as a URI scheme and
        // fails the build with an UnhandledSchemeError before any resolve
        // plugin runs (field-caught by the Next playground build), so bundle
        // delivery is rollup-convention only — the webpack lane keeps its own
        // map delivery. The dev-mode mangling guard stays as well: dev CSS is
        // unmangled, so no lane may deliver a real map in development.
        const plugin = rawInstance.raw({}, { framework: 'webpack' }) as unknown as {
            vite: { configResolved: (config: unknown) => void };
            webpack: (compiler: unknown) => void;
            transform: (this: unknown, code: string, id: string) => Promise<unknown> | unknown;
        };
        const root = resolve(homedir(), '.cache/csszyx-tests/mangle-runtime-webpack-dev');
        const ctx = { warn() {}, error() {} };
        plugin.vite.configResolved({ root, command: 'build' });

        const prodOut = (await plugin.transform.call(
            ctx,
            RUNTIME_CONSUMER,
            `${root}/src/a.ts`,
        )) as { code?: string } | null;
        expect(prodOut?.code ?? RUNTIME_CONSUMER).not.toContain(MANGLE_RUNTIME_VIRTUAL_ID);

        plugin.webpack({
            options: { mode: 'development' },
            context: root,
            hooks: {
                beforeCompile: { tap: () => undefined },
                thisCompilation: { tap: () => undefined },
            },
        });
        const devOut = (await plugin.transform.call(ctx, RUNTIME_CONSUMER, `${root}/src/a.ts`)) as {
            code?: string;
        } | null;
        expect(devOut?.code ?? RUNTIME_CONSUMER).not.toContain(MANGLE_RUNTIME_VIRTUAL_ID);
    });
});
