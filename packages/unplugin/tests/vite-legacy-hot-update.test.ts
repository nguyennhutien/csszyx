/**
 * Vite 5 calls `handleHotUpdate` and nothing else.
 *
 * `hotUpdate` is the per-environment hook Vite 6 introduced. A plugin that
 * declares only that one is never told about a file change on Vite 5, so an
 * `sz` edit that introduces a class the prescan did not see produces no CSS:
 * the safelist is never rewritten, the page stays open, the element loses
 * its padding, and nothing in the terminal says why (field-reported; the
 * upgrade that moved the hook had looked clean because the build side was).
 *
 * Both hooks can be declared. Vite 6 and later pick `hotUpdate` and ignore
 * the legacy one (`plugin.hotUpdate ?? plugin.handleHotUpdate`, vite 8.2.1);
 * Vite 5 knows only the legacy one. The legacy hook runs once, with no
 * environment and no `server.environments`, so it reads as the client pass
 * and answers from `server.moduleGraph`.
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
 * Load the Vite plugins and drive their hooks the way Vite 5 does: the legacy
 * hook, a minimal plugin context with no `environment`, and a server that has
 * a single `moduleGraph` and no `environments` at all.
 *
 * @returns A `call` helper plus the paths and fakes the assertions need.
 */
async function setupVite5Project(): Promise<{
    plugins: Array<Record<string, unknown>>;
    call: (hookName: string, ...args: unknown[]) => Promise<unknown>;
    root: string;
    safelistPath: string;
    styleModule: { id: string; type: string };
    server: unknown;
}> {
    const { vitePlugin } = await import('../src/unplugin.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-vite5-hmr-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });

    const plugins = vitePlugin({}) as Array<Record<string, unknown>>;
    const baseCtx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in p);
        const hook = plugin?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(baseCtx, args) : undefined;
    };
    await call('configResolved', { root, command: 'serve' });

    const entryFile = path.join(root, 'src/index.css');
    await call('transform', '@import "tailwindcss";', entryFile);

    const styleModule = { id: entryFile, type: 'js' };
    const safelistPath = path.join(root, '.csszyx/csszyx-classes.txt');
    const server = {
        config: { root },
        watcher: { emit() {} },
        ws: { send() {} },
        moduleGraph: {
            getModuleById: () => null,
            invalidateModule() {},
            getModulesByFile: (file: string) => (file === entryFile ? [styleModule] : undefined),
        },
    };
    return { plugins, call, root, safelistPath, styleModule, server };
}

/**
 * The context Vite 5 hands `handleHotUpdate`: the changed file, when, the
 * modules it already matched, a reader, and the server.
 *
 * @param file - The changed file.
 * @param modules - What Vite matched the file to.
 * @param server - The dev server fake.
 * @returns A Vite 5 `HmrContext`.
 */
function hmrContext(file: string, modules: unknown[], server: unknown): Record<string, unknown> {
    return {
        file,
        timestamp: Date.now(),
        modules,
        read: () => fs.promises.readFile(file, 'utf8'),
        server,
    };
}

describe('handleHotUpdate on Vite 5', () => {
    it('is declared next to hotUpdate so both Vite generations get a hook', async () => {
        const { plugins } = await setupVite5Project();
        const withNew = plugins.filter(p => p && 'hotUpdate' in p);
        const withLegacy = plugins.filter(p => p && 'handleHotUpdate' in p);
        expect(withNew.length, 'the Vite 6+ hook must stay').toBe(1);
        expect(withLegacy.length, 'Vite 5 calls handleHotUpdate only').toBe(1);
        expect(withLegacy[0]).toBe(withNew[0]);
    });

    it('learns the classes of an edited source file', async () => {
        const { call, root, safelistPath, server } = await setupVite5Project();
        const file = path.join(root, 'src/Card.tsx');
        fs.writeFileSync(file, 'export const Card = () => <div sz={{ px: 71 }} />;');

        const answer = await call('handleHotUpdate', hmrContext(file, [], server));

        expect(answer, 'an ordinary source file is left to Vite').toBeUndefined();
        expect(
            fs.existsSync(safelistPath),
            'the edit never reached the safelist, so Tailwind has no CSS to emit',
        ).toBe(true);
        expect(fs.readFileSync(safelistPath, 'utf8')).toContain('px-71');
    });

    it('names the Tailwind entry from server.moduleGraph when the safelist changes', async () => {
        const { call, safelistPath, styleModule, server } = await setupVite5Project();

        const answer = await call(
            'handleHotUpdate',
            hmrContext(safelistPath, [{ id: safelistPath, type: 'asset' }], server),
        );

        expect(Array.isArray(answer), 'silence lets @tailwindcss/vite reload the page').toBe(true);
        expect(answer).toContain(styleModule);
    });
});
