/**
 * The real vite handleHotUpdate hook's incremental discovery branches and the
 * esbuild factory — driven through the actual plugin objects, not mirrored
 * logic. The HMR edges (no-sz skip, unparseable file, no-op transform, new
 * classes) only existed as a logic mirror before, which covers nothing in
 * unplugin.ts itself.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { esbuildPlugin, vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Boot the real vite plugin in serve mode rooted at a temp project.
 * @returns The project root plus hook invokers. */
async function bootedPlugin(): Promise<{
    root: string;
    call: (hook: string, ...args: unknown[]) => Promise<unknown>;
    hotUpdate: (file: string, extra?: Record<string, unknown>) => Promise<unknown>;
}> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-hmr-real-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    const plugins = vitePlugin({});
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
    await call('configResolved', { root, command: 'serve' });
    const server = {
        config: { root },
        watcher: { emit() {} },
        moduleGraph: { getModuleById: () => null, invalidateModule() {} },
    };
    const hotUpdate = (file: string, extra: Record<string, unknown> = {}): Promise<unknown> =>
        call('handleHotUpdate', { file, server, modules: [], ...extra });
    return { root, call, hotUpdate };
}

describe('handleHotUpdate incremental discovery (real hook)', () => {
    it('skips files without sz usage after reading them', async () => {
        const { root, hotUpdate } = await bootedPlugin();
        const file = path.join(root, 'src/Plain.tsx');
        fs.writeFileSync(file, 'export const Plain = () => <div className="p-4" />;');
        await hotUpdate(file);
        expect(fs.existsSync(path.join(root, 'csszyx-classes.html'))).toBe(false);
    });

    it('survives a file that fails to parse', async () => {
        const { root, hotUpdate } = await bootedPlugin();
        const file = path.join(root, 'src/Broken.tsx');
        fs.writeFileSync(file, 'export const Broken = () => <div sz={{ p: 4 } // unclosed');
        await expect(hotUpdate(file)).resolves.toBeUndefined();
    });

    it('ignores a deleted file the watcher still reports', async () => {
        const { root, hotUpdate } = await bootedPlugin();
        await expect(hotUpdate(path.join(root, 'src/Gone.tsx'))).resolves.toBeUndefined();
    });

    it('discovers new classes in a changed file and writes the safelist', async () => {
        const { root, hotUpdate } = await bootedPlugin();
        const file = path.join(root, 'src/App.tsx');
        fs.writeFileSync(file, 'export const App = () => <div sz={{ m: 3 }} />;');
        await hotUpdate(file);
        const safelist = path.join(root, 'csszyx-classes.html');
        expect(fs.existsSync(safelist)).toBe(true);
        expect(fs.readFileSync(safelist, 'utf8')).toContain('m-3');
        // A second update with the same content discovers nothing new.
        await expect(hotUpdate(file)).resolves.toBeUndefined();
    });
});

describe('esbuildPlugin factory', () => {
    it('registers both pre and post setups on one esbuild build object', () => {
        const plugin = esbuildPlugin({});
        expect(plugin.name).toBe('csszyx');
        const registered: string[] = [];
        const build = {
            initialOptions: {},
            onStart: () => registered.push('onStart'),
            onEnd: () => registered.push('onEnd'),
            onResolve: () => registered.push('onResolve'),
            onLoad: () => registered.push('onLoad'),
            onDispose: () => registered.push('onDispose'),
            esbuild: { version: '0.27.0' },
        };
        plugin.setup(build as never);
        expect(registered.length).toBeGreaterThan(0);
    });
});
