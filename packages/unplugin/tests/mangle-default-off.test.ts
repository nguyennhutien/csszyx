/**
 * Locks class mangling as opt-IN.
 *
 * It used to be on unless explicitly disabled, which meant every production
 * build paid for a runtime mangle map it never asked for — and, over a
 * compressed response, paid in net bytes rather than saving them. The default
 * is behaviour every consumer inherits silently, so it gets its own net: an
 * accidental flip back would be invisible in any test that passes an explicit
 * `production.mangle`.
 */
import { describe, expect, it } from 'vitest';
import { vitePlugin } from '../src/unplugin.js';
import { MANGLE_RUNTIME_VIRTUAL_ID } from '../src/virtual-modules.js';
import { freshFixtureRoot } from './fixture-root.js';

const RUNTIME_CONSUMER = `import { szr } from '@csszyx/runtime';\nexport const c = szr({ p: 4 });\n`;
const SZ_SOURCE = `export const App = <div sz={{ p: 4 }} className="raw-keep" />;\n`;

/**
 * Drive the pre-plugin's hooks with a given production config.
 *
 * @param production - Production options handed to the plugin.
 * @returns Hook caller plus the fake project root.
 */
function harness(production?: Record<string, unknown>) {
    const plugins = vitePlugin(production ? { production } : {});
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        if (!plugin) return undefined;
        const hook = (plugin as Record<string, unknown>)[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
    const root = freshFixtureRoot('mangle-default');
    return { call, root };
}

/**
 * Transform a runtime-helper module and report whether bundle map delivery ran.
 *
 * Bundle delivery is gated on mangling being enabled, so it is a faithful
 * proxy for "did this build turn mangling on".
 *
 * @param production - Production options handed to the plugin.
 * @returns True when the map module was injected.
 */
async function injectsMangleRuntime(production?: Record<string, unknown>): Promise<boolean> {
    const { call, root } = harness(production);
    await call('configResolved', { root, command: 'build' });
    const out = (await call('transform', RUNTIME_CONSUMER, `${root}/src/a.ts`)) as {
        code?: string;
    } | null;
    return (out?.code ?? '').includes(MANGLE_RUNTIME_VIRTUAL_ID);
}

describe('production.mangle defaults to off', () => {
    it('does not mangle when production config is absent entirely', async () => {
        expect(await injectsMangleRuntime()).toBe(false);
    });

    it('does not mangle when production is given without a mangle key', async () => {
        expect(await injectsMangleRuntime({ injectChecksum: true })).toBe(false);
    });

    it('does not mangle when mangle is explicitly undefined', async () => {
        // `{ mangle: undefined }` is what spreading an optional config produces;
        // it must read the same as an absent key, not as an opt-in.
        expect(await injectsMangleRuntime({ mangle: undefined })).toBe(false);
    });

    it('does not mangle when mangle is explicitly false', async () => {
        expect(await injectsMangleRuntime({ mangle: false })).toBe(false);
    });

    it('mangles only on an explicit true', async () => {
        expect(await injectsMangleRuntime({ mangle: true })).toBe(true);
    });

    it('treats truthy non-true values as off', async () => {
        // Guards the `!== false` shape this replaced: under it, any truthy or
        // even nullish value enabled mangling. Only a real `true` may.
        expect(await injectsMangleRuntime({ mangle: 1 as unknown as boolean })).toBe(false);
        expect(await injectsMangleRuntime({ mangle: 'yes' as unknown as boolean })).toBe(false);
        expect(await injectsMangleRuntime({ mangle: null as unknown as boolean })).toBe(false);
    });

    it('leaves emitted class names readable by default', async () => {
        const { call, root } = harness();
        await call('configResolved', { root, command: 'build' });
        const out = (await call('transform', SZ_SOURCE, `${root}/src/App.jsx`)) as {
            code?: string;
        } | null;

        // The lowered class must survive under its original name: nothing was
        // opted into mangling, so no token may appear in its place.
        expect(out?.code ?? '').toContain('p-4');
    });

    it('keeps mangling off in a dev server even when explicitly enabled', async () => {
        const { call, root } = harness({ mangle: true });
        await call('configResolved', { root, command: 'serve' });
        const out = (await call('transform', RUNTIME_CONSUMER, `${root}/src/a.ts`)) as {
            code?: string;
        } | null;

        expect((out?.code ?? '').includes(MANGLE_RUNTIME_VIRTUAL_ID)).toBe(false);
    });
});
