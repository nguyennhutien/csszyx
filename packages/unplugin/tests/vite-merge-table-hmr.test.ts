/**
 * The merge table following a stylesheet edit on a dev server.
 *
 * `szcn` merges on a table the build settles from the compiled CSS, and a dev
 * server serves that table as a module the page loads once. A stylesheet edit
 * is a CSS hot update: Vite swaps the styles and re-executes no JavaScript, so
 * a token the stylesheet dropped would keep merging from the table the page
 * booted with. The module has to be invalidated and the page reloaded, and
 * only when the table changed, so an ordinary CSS edit keeps its hot update.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { RESOLVED_UNSERVED_VIRTUAL_ID } from '../src/virtual-modules.js';
import {
    callHooks,
    linkTailwindIntegration,
    removeTailwindProjects,
    tailwindProject,
} from './tailwind-project.js';

const APP = [
    "import { szcn } from '@csszyx/runtime';",
    "export const App = () => <div className={szcn('text-brand', 'text-accent')} />;",
    '',
].join('\n');
const BOTH =
    '@import "tailwindcss";\n@theme {\n  --color-brand: #000;\n  --color-accent: #fff;\n}\n';
const BRAND_ONLY = '@import "tailwindcss";\n@theme {\n  --color-brand: #000;\n}\n';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * A dev server over one project, recording what it tells the page.
 *
 * @param shape - Which Vite the server looks like.
 * @param shape.vite5 - No per-environment graphs, and a module graph that has
 *        not loaded the table module.
 * @returns The handles a case drives it with.
 */
async function devServer({ vite5 = false } = {}) {
    const root = tailwindProject('csszyx-merge-table-hmr-', {
        'src/index.css': BOTH,
        'src/App.tsx': APP,
    });
    linkTailwindIntegration(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugins = vitePlugin({ build: { cache: false }, production: { mangle: false } });
    const call = callHooks(plugins as unknown as Record<string, unknown>[]);
    await call('configResolved', { root, command: 'serve' });

    const sent: unknown[] = [];
    const invalidated: string[] = [];
    const graph = {
        getModuleById: (id: string) => (vite5 ? undefined : { id }),
        invalidateModule(module_: { id: string }) {
            invalidated.push(module_.id);
        },
        getModulesByFile: () => undefined,
        invalidateAll() {},
    };
    const server = {
        config: { root },
        watcher: { emit() {} },
        ws: { send: (message: unknown) => sent.push(message) },
        moduleGraph: graph,
        ...(vite5 ? {} : { environments: { client: { moduleGraph: graph } } }),
    };
    const edit = async (css: string) => {
        const file = join(root, 'src/index.css');
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, css, 'utf8');
        await call(vite5 ? 'handleHotUpdate' : 'hotUpdate', {
            type: 'update',
            file,
            modules: [],
            server,
        });
    };
    // Only the table: a class that lost its CSS moves to the unserved list,
    // which the same module registers.
    const table = async () =>
        ((await call('load', RESOLVED_UNSERVED_VIRTUAL_ID)) as string).split(
            'registerMergeSignatures(',
        )[1] ?? '';
    const editSource = async ({
        content,
        file = 'src/App.tsx',
        environment = 'client',
    }: {
        content: string;
        file?: string;
        environment?: string;
    }) => {
        const absolute = join(root, file);
        writeFileSync(absolute, content);
        const ctx = { type: 'update', file: absolute, modules: [], server };
        if (vite5) return call('handleHotUpdate', ctx);
        const plugin = plugins.find(plugin => plugin && 'hotUpdate' in plugin);
        expect(plugin).toBeDefined();
        const hook = (plugin as { hotUpdate: (context: typeof ctx) => unknown }).hotUpdate;
        return hook.call({ environment: { name: environment, moduleGraph: graph } }, ctx);
    };
    return { edit, editSource, table, sent, invalidated };
}

describe('the merge table on a dev server', () => {
    it('drops a token the stylesheet stops declaring, and reloads the page', async () => {
        const dev = await devServer();
        expect(await dev.table()).toContain('text-accent');

        await dev.edit(BRAND_ONLY);

        expect(dev.invalidated).toContain(RESOLVED_UNSERVED_VIRTUAL_ID);
        expect(dev.sent).toContainEqual({ type: 'full-reload' });
        expect(await dev.table()).not.toContain('text-accent');
    }, 120_000);

    it('reloads the page on Vite 5, whose one graph may not hold the module', async () => {
        const dev = await devServer({ vite5: true });
        await dev.table();

        await dev.edit(BRAND_ONLY);

        expect(dev.invalidated).toEqual([]);
        expect(dev.sent).toContainEqual({ type: 'full-reload' });
    }, 120_000);

    it('stops serving the old table when no stylesheet compiles a design system', async () => {
        // Left over, the table from the last good compile would go on
        // merging classes the project no longer has CSS for.
        const dev = await devServer();
        expect(await dev.table()).toContain('text-accent');

        await dev.edit('.card { color: red; }\n');

        expect(await dev.table()).not.toContain('text-accent');
    }, 120_000);

    it('keeps the ordinary hot update for an edit that leaves the table alone', async () => {
        const dev = await devServer();
        await dev.table();

        await dev.edit(`${BOTH}.card { color: red; }\n`);

        expect(dev.invalidated).not.toContain(RESOLVED_UNSERVED_VIRTUAL_ID);
        expect(dev.sent).not.toContainEqual({ type: 'full-reload' });
    }, 120_000);

    it.each([false, true])('refreshes source candidates with the Vite 5 hook: %s', async vite5 => {
        const dev = await devServer({ vite5 });
        await dev.table();
        await dev.editSource({ content: APP.replace('text-accent', 'p-2 p-4') });
        expect(dev.sent).toEqual([
            {
                type: 'custom',
                event: 'csszyx:merge-table',
                data: {
                    classes: expect.any(Array),
                    table: expect.any(Array),
                    format: 1,
                },
            },
        ]);
        expect(await dev.table()).toContain('p-2');
        dev.sent.length = 0;
        dev.invalidated.length = 0;
        await dev.editSource({ content: `${APP.replace('text-accent', 'p-2 p-4')}\n// edit` });
        expect(dev.sent).toEqual([]);
        expect(dev.invalidated).toEqual([]);
    });

    it('does not settle a registration before the first load', async () => {
        const dev = await devServer();
        await dev.editSource({ content: APP.replace('text-accent', 'p-2 p-4') });
        expect(dev.sent).toEqual([]);
        expect(dev.invalidated).toEqual([]);
        expect(await dev.table()).toContain('p-2');
    });

    it('leaves non-client passes and non-source files to Vite', async () => {
        const dev = await devServer();
        await dev.table();
        await dev.editSource({ content: APP.replace('text-accent', 'p-2'), environment: 'ssr' });
        await dev.editSource({ content: 'p-1', file: 'notes.txt' });
        expect(dev.sent).toEqual([]);
        expect(dev.invalidated).toEqual([]);
        // The following client pass still owes the update skipped by SSR.
        await dev.editSource({ content: APP.replace('text-accent', 'p-2') });
        expect(dev.sent).toEqual([
            expect.objectContaining({ type: 'custom', event: 'csszyx:merge-table' }),
        ]);
    });
});
