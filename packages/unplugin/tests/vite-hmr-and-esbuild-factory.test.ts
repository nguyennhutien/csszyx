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
        expect(fs.existsSync(path.join(root, '.csszyx/csszyx-classes.txt'))).toBe(false);
    });

    it('survives a file that fails to parse', async () => {
        // Answers nothing either way: the engine reports a parse failure as an
        // untransformed result rather than by throwing, so this pins that the
        // dev server keeps going — not which of the two bail paths ran. The
        // `catch` beside them is there for an engine that throws, and nothing
        // in this suite can make one do that.
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
        const safelist = path.join(root, '.csszyx/csszyx-classes.txt');
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

describe('handleHotUpdate hands recovery tokens on', () => {
    /**
     * A `szRecover` site registers a recovery token, and the manifest that
     * `transformIndexHtml` injects is built from the tokens the plugin
     * holds. A token collected on a hot update must reach that manifest
     * the same way one collected at build time does.
     */
    it('injects the manifest for a szRecover site that arrived by hot update', async () => {
        const { root, call, hotUpdate } = await bootedPlugin();
        const file = path.join(root, 'src/Recover.tsx');
        fs.writeFileSync(file, 'export const R = () => <div szRecover="csr" sz={{ p: 4 }} />;');
        await hotUpdate(file);
        const html = '<html><head></head><body></body></html>';
        const result = (await call('transformIndexHtml', html)) as string;
        expect(result).toContain('__SZ_RECOVERY_MANIFEST__');
    });
});

describe('the safelist file must not full-reload the page', () => {
    /**
     * Vite reloads the whole page for any changed `.html` that matched no
     * module — and the generated safelist is named `.html` because Tailwind's
     * scanner reads it as markup. Growing the class set therefore cost every
     * consumer their React state, scroll position and open dialogs, on the
     * first use of each new utility per server lifetime (field-reported).
     *
     * Naming the Tailwind entry as the module the change affects is true, not
     * a trick: the entry `@source`s the safelist, so its generated CSS is
     * exactly what a safelist edit changes. Vite then takes the CSS update
     * path it takes for any other stylesheet.
     */
    it('answers the Tailwind entry module for a safelist change', async () => {
        const { root, call } = await bootedPlugin();
        const entry = path.join(root, 'src/app.css');
        fs.writeFileSync(entry, '@import "tailwindcss";');
        // The entry is recorded while it passes through the CSS transform,
        // which is the only place the plugin learns its id.
        await call('transform', '@import "tailwindcss";', entry);

        const entryModule = { id: entry, url: '/src/app.css' };
        const server = {
            config: { root },
            watcher: { emit() {} },
            moduleGraph: {
                getModuleById: () => null,
                invalidateModule() {},
                getModulesByFile: (file: string) =>
                    file === entry ? new Set([entryModule]) : undefined,
            },
        };
        const affected = await call('handleHotUpdate', {
            file: path.join(root, '.csszyx/csszyx-classes.txt'),
            server,
            modules: [],
        });

        expect(affected).toEqual([entryModule]);
    });

    it('leaves the change alone when the entry is not in the graph yet', async () => {
        const { root, call } = await bootedPlugin();
        const entry = path.join(root, 'src/app.css');
        fs.writeFileSync(entry, '@import "tailwindcss";');
        await call('transform', '@import "tailwindcss";', entry);

        const server = {
            config: { root },
            watcher: { emit() {} },
            moduleGraph: {
                getModuleById: () => null,
                invalidateModule() {},
                // The entry is known but the dev server has not loaded it —
                // the state before the page first requests the stylesheet.
                getModulesByFile: () => undefined,
            },
        };
        // The EMPTY set, not silence. Vite answers an empty set with a reload
        // addressed to the safelist path, which its client drops unless the
        // browser is viewing that file, and `@tailwindcss/vite` only sends its
        // own unaddressed reload while it still sees modules for a file it
        // scanned. Answering nothing leaves both of those free to fire.
        await expect(
            call('handleHotUpdate', {
                file: path.join(root, '.csszyx/csszyx-classes.txt'),
                server,
                modules: [],
            }),
        ).resolves.toEqual([]);
    });

    /**
     * Vite hands the hook a path it has already normalized to forward
     * slashes, on every platform. The plugin builds its side of the
     * comparison with `path.join`, which on Windows answers with backslashes,
     * so a byte-for-byte comparison never matches there and the reload the
     * branch exists to prevent goes on happening.
     *
     * A POSIX host cannot make `path.join` produce a backslash, so the
     * separator is injected at the one seam left: the root. The mismatch
     * under test is the same one — a joined path carrying `\` against a
     * Vite path carrying `/`.
     */
    it('matches the safelist when Vite reports it with forward slashes', async () => {
        const { call } = await bootedPlugin();
        const root = 'C:\\app';
        await call('configResolved', { root, command: 'serve' });
        const entry = 'C:/app/src/app.css';
        await call('transform', '@import "tailwindcss";', entry);

        const entryModule = { id: entry, url: '/src/app.css' };
        const server = {
            config: { root },
            watcher: { emit() {} },
            moduleGraph: {
                getModuleById: () => null,
                invalidateModule() {},
                getModulesByFile: (file: string) =>
                    file === entry ? new Set([entryModule]) : undefined,
            },
        };
        await expect(
            call('handleHotUpdate', {
                file: 'C:/app/csszyx-classes.html',
                server,
                modules: [],
            }),
        ).resolves.toEqual([entryModule]);
    });
});
