/**
 * A barrel discovered mid-session, through the dev-server edit path.
 *
 * The prescan collects which modules to read from a whole-project walk, so it
 * only knows the imports that existed when the server started. Adding a style
 * import mid-session names a module nothing had demanded — and when that module
 * is a BARREL, the module it forwards to was not demanded either, one hop
 * further out. Following the links as demand is what keeps the mid-session
 * answer the same as the one a restart would give.
 *
 * Driven through the real plugin hooks rather than the pure helpers, because
 * the part under test is which files the plugin decides to READ, and that
 * decision only exists during a build.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Harness {
    root: string;
    invoke: (hook: string, ...args: unknown[]) => Promise<unknown>;
}

/**
 * Build a throwaway project and a hook invoker over the real plugin objects.
 *
 * @param files - Project-relative path to contents.
 * @returns The root and a hook invoker.
 */
function harness(files: Record<string, string>): Harness {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-watch-fwd-'));
    tempDirs.push(root);
    for (const [name, contents] of Object.entries(files)) {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents, 'utf8');
    }
    const plugins = vitePlugin({ build: { cache: false } });
    const ctx = { warn() {}, error() {}, addWatchFile() {} };
    const invoke = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        if (!plugin) return undefined;
        const hook = (plugin as Record<string, unknown>)[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
    return { root, invoke };
}

describe('a barrel reached only after the prescan', () => {
    it('folds a style the importer newly asks for through a barrel', async () => {
        // `tokens.ts` is imported by nobody at start-up: only the barrel names
        // it, and the barrel itself is only named by the edit below.
        const h = harness({
            'src/tokens.ts': "export const cardSz = { p: 7, rounded: 'lg' };\n",
            'src/index.ts': "export { cardSz } from './tokens';\n",
            'src/App.tsx': 'export const App = () => <div sz={{ m: 1 }} />;\n',
        });

        await h.invoke('configResolved', { root: h.root, command: 'serve' });
        await h.invoke('buildStart');

        const edited =
            "import { cardSz } from './index';\nexport const App = () => <div sz={cardSz} />;\n";
        const appPath = path.join(h.root, 'src/App.tsx');
        fs.writeFileSync(appPath, edited, 'utf8');
        await h.invoke('watchChange', appPath, { event: 'update' });

        const result = (await h.invoke('transform', edited, appPath)) as { code: string } | null;

        expect(result?.code).toContain('p-7');
        expect(result?.code).not.toContain('_sz(');
    });

    it('reads a module named twice only once', async () => {
        // Two imports of one specifier, and a barrel forwarding two names out
        // of one module: both make the same provider demanded twice, and the
        // walk has to notice rather than queue it again.
        const h = harness({
            'src/tokens.ts':
                "export const cardSz = { p: 7, rounded: 'lg' };\nexport const rowSz = { m: 3 };\n",
            'src/index.ts': "export { cardSz, rowSz } from './tokens';\n",
            'src/App.tsx': 'export const App = () => <div sz={{ m: 1 }} />;\n',
        });

        await h.invoke('configResolved', { root: h.root, command: 'serve' });
        await h.invoke('buildStart');

        const edited =
            "import { cardSz } from './index';\n" +
            "import { rowSz } from './index';\n" +
            'export const App = () => <div sz={cardSz} />;\n' +
            'export const Row = () => <div sz={rowSz} />;\n';
        const appPath = path.join(h.root, 'src/App.tsx');
        fs.writeFileSync(appPath, edited, 'utf8');
        await h.invoke('watchChange', appPath, { event: 'update' });

        const result = (await h.invoke('transform', edited, appPath)) as { code: string } | null;

        expect(result?.code).toContain('p-7');
        expect(result?.code).toContain('m-3');
    });
});
