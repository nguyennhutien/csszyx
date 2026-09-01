/**
 * The safelist branch has to answer for a file the watcher reports as CREATED,
 * not only as changed.
 *
 * `writeSafelistFile` returns early on an empty class set, so a project with no
 * `sz` at prescan starts with no safelist file at all. The first `sz` edit
 * therefore CREATES it, and Vite routes a create to `hotUpdate` only: its
 * legacy `handleHotUpdate` branch runs for `type === 'update'` and nothing else
 * (`getSortedHotUpdatePlugins` loop, vite 8.2.1). With csszyx silent on that
 * event, `@tailwindcss/vite` sees the asset nodes `addWatchFile` left for a
 * file it scanned and answers with its unaddressed `full-reload` — the exact
 * page-state loss the safelist branch exists to prevent.
 *
 * Answering with the Tailwind entry modules is what keeps Vite on its CSS
 * update path. An empty array is safe too, because `@tailwindcss/vite` returns
 * early on an empty module list; silence is the only unsafe answer.
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
 * Load the Vite plugins and drive their hooks the way Vite would.
 *
 * @returns A `call` helper bound to a root directory that has a registered
 * Tailwind entry, plus the paths and fakes the assertions need.
 */
async function setupProject(): Promise<{
    call: (hookName: string, ...args: unknown[]) => Promise<unknown>;
    callWith: (self: object, hookName: string, ...args: unknown[]) => Promise<unknown>;
    root: string;
    safelistPath: string;
    entryFile: string;
    styleModule: { id: string; type: string };
    server: unknown;
}> {
    const { vitePlugin } = await import('../src/unplugin.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-hot-create-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });

    const plugins = vitePlugin({});
    const baseCtx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const callWith = async (
        self: object,
        hookName: string,
        ...args: unknown[]
    ): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        const hook = (plugin as Record<string, unknown> | undefined)?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(self, args) : undefined;
    };
    const call = async (hookName: string, ...args: unknown[]): Promise<unknown> =>
        callWith(baseCtx, hookName, ...args);
    await call('configResolved', { root, command: 'serve' });

    // Registering the entry is what gives the safelist branch something to
    // name; a project with no Tailwind entry has no stylesheet to hot-update.
    const entryFile = path.join(root, 'src/index.css');
    await call('transform', '@import "tailwindcss";', entryFile);

    const styleModule = { id: entryFile, type: 'js' };
    const safelistPath = path.join(root, '.csszyx/csszyx-classes.txt');
    const moduleGraph = {
        getModuleById: () => null,
        invalidateModule() {},
        getModulesByFile: (file: string) => (file === entryFile ? [styleModule] : undefined),
    };
    const server = {
        config: { root },
        watcher: { emit() {} },
        ws: { send() {} },
        moduleGraph,
        // Vite assigns a `hotUpdate` answer straight into the client
        // environment's module list, so that is the graph the hook reads.
        environments: { client: { moduleGraph } },
    };
    return { call, callWith, root, safelistPath, entryFile, styleModule, server };
}

describe('hotUpdate on the generated safelist', () => {
    it('names the Tailwind entry when the safelist is created, not only changed', async () => {
        const { call, safelistPath, styleModule, server } = await setupProject();

        // `modules` carries the asset node Tailwind's own `addWatchFile` left
        // behind — the input that makes it send `full-reload` when no plugin
        // answers first.
        const answer = await call('hotUpdate', {
            type: 'create',
            file: safelistPath,
            modules: [{ id: safelistPath, type: 'asset' }],
            server,
        });

        expect(Array.isArray(answer), 'silence lets @tailwindcss/vite reload the page').toBe(true);
        expect(answer).toContain(styleModule);
    });

    it('still answers for an ordinary safelist change', async () => {
        const { call, safelistPath, styleModule, server } = await setupProject();

        const answer = await call('hotUpdate', {
            type: 'update',
            file: safelistPath,
            modules: [{ id: safelistPath, type: 'asset' }],
            server,
        });

        expect(answer).toContain(styleModule);
    });

    it('answers each environment from its own graph', async () => {
        const { callWith, safelistPath, entryFile, server } = await setupProject();
        // The ssr pass gets its own module objects; handing it the client's
        // would put foreign nodes into the list Vite replaces for ssr.
        const ssrModule = { id: entryFile, type: 'js', environment: 'ssr' };
        const ssr = {
            environment: {
                name: 'ssr',
                moduleGraph: {
                    getModulesByFile: (file: string) =>
                        file === entryFile ? [ssrModule] : undefined,
                },
            },
        };

        const answer = await callWith(ssr, 'hotUpdate', {
            type: 'create',
            file: safelistPath,
            modules: [{ id: safelistPath, type: 'asset' }],
            server,
        });

        expect(answer).toContain(ssrModule);
    });

    it('discovers classes on the client pass only, not once per environment', async () => {
        const { callWith, root, server } = await setupProject();
        const file = path.join(root, 'src/Card.tsx');
        fs.writeFileSync(file, 'export const Card = () => <div sz={{ p: 4 }} />;');
        const safelist = path.join(root, '.csszyx/csszyx-classes.txt');

        // Vite runs the non-client passes after the client one; re-reading and
        // re-transforming the file there is pure waste, so the pass must be a
        // no-op for everything but the answer.
        const ssr = {
            environment: { name: 'ssr', moduleGraph: { getModulesByFile: () => undefined } },
        };
        await callWith(ssr, 'hotUpdate', { type: 'update', file, modules: [], server });
        expect(fs.existsSync(safelist), 'the ssr pass must not run discovery').toBe(false);

        const client = {
            environment: { name: 'client', moduleGraph: { getModulesByFile: () => undefined } },
        };
        await callWith(client, 'hotUpdate', { type: 'update', file, modules: [], server });
        expect(fs.readFileSync(safelist, 'utf8')).toContain('p-4');
    });

    it('leaves an ordinary source file to Vite so class discovery still runs', async () => {
        const { call, root, server } = await setupProject();
        const file = path.join(root, 'src/Card.tsx');
        fs.writeFileSync(file, 'export const Card = () => <div sz={{ p: 4 }} />;');

        const answer = await call('hotUpdate', {
            type: 'update',
            file,
            modules: [],
            server,
        });

        expect(answer).toBeUndefined();
        // Discovery is the point: the edit has to reach the safelist.
        expect(fs.readFileSync(path.join(root, '.csszyx/csszyx-classes.txt'), 'utf8')).toContain(
            'p-4',
        );
    });
});
