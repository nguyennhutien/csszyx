/**
 * A Vue SFC style block must not register its `.vue` file as a Tailwind entry.
 *
 * Vite gives a single-file component's style block an id like
 * `App.vue?vue&type=style&index=0&lang.css`, which ends in `.css` and so reaches
 * the stylesheet transform. Splitting the query off that id leaves `App.vue` —
 * the whole component, not its style block. Recorded as a Tailwind entry, every
 * later safelist write answers with `getModulesByFile('App.vue')`, and that is
 * every sub-module the SFC compiled to: template, script setup and style alike.
 * Vite then sends a `js-update` for the component, so Vue re-runs it and the
 * component's own state is gone — the safelist branch exists to prevent exactly
 * that kind of loss, and here it would cause one.
 *
 * A style block that imports Tailwind is unusual (the import normally lives in a
 * standalone stylesheet), so declining to treat it as an entry costs a rare
 * project the reload it would have had before, and spares every SFC project the
 * component reset.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Boot the Vite plugins over a throwaway project.
 *
 * @returns The hook caller and the project root.
 */
async function bootPlugin(): Promise<{
    call: (hookName: string, ...args: unknown[]) => Promise<unknown>;
    root: string;
}> {
    const { vitePlugin } = await import('../src/unplugin.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-sfc-entry-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });

    const plugins = vitePlugin({});
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        const hook = (plugin as Record<string, unknown> | undefined)?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
    await call('configResolved', { root, command: 'serve' });
    return { call, root };
}

describe('a Tailwind import inside an SFC style block', () => {
    it('does not make the component a Tailwind entry', async () => {
        const { call, root } = await bootPlugin();
        const component = path.join(root, 'src/App.vue');
        await call(
            'transform',
            '@import "tailwindcss";',
            `${component}?vue&type=style&index=0&lang.css`,
        );

        // What the module graph holds for `App.vue`: the script the component
        // runs, not a stylesheet. Naming it as affected is what resets the
        // component.
        const scriptModule = { id: `${component}?vue&type=script`, type: 'js' };
        const moduleGraph = {
            getModuleById: () => null,
            invalidateModule() {},
            getModulesByFile: (file: string) => (file === component ? [scriptModule] : undefined),
        };
        const server = {
            config: { root },
            watcher: { emit() {} },
            ws: { send() {} },
            moduleGraph,
            environments: { client: { moduleGraph } },
        };

        const answer = await call('hotUpdate', {
            type: 'update',
            file: path.join(root, '.csszyx/csszyx-classes.txt'),
            modules: [],
            server,
        });

        expect(answer).toEqual([]);
    });

    it('still registers an ordinary stylesheet that Vite gave a query', async () => {
        const { call, root } = await bootPlugin();
        const entry = path.join(root, 'src/index.css');
        await call('transform', '@import "tailwindcss";', `${entry}?direct`);

        const styleModule = { id: `${entry}?direct`, type: 'css' };
        const moduleGraph = {
            getModuleById: () => null,
            invalidateModule() {},
            getModulesByFile: (file: string) => (file === entry ? [styleModule] : undefined),
        };
        const server = {
            config: { root },
            watcher: { emit() {} },
            ws: { send() {} },
            moduleGraph,
            environments: { client: { moduleGraph } },
        };

        const answer = await call('hotUpdate', {
            type: 'update',
            file: path.join(root, '.csszyx/csszyx-classes.txt'),
            modules: [],
            server,
        });

        expect(answer).toEqual([styleModule]);
    });
});
