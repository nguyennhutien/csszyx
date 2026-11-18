/**
 * A hot update lowers the modules a build lowers. The hook once kept its own
 * copy of the transform's text gate, which read `sz=` only: a module spelling
 * the attribute `sz = {{…}}`, as JSX allows, was recorded untransformed on
 * every edit, so its classes never reached the safelist in dev.
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
 * Save `source` as a module of a dev server and send it through `hotUpdate`.
 *
 * @param source - The module's text.
 * @returns The safelist the update wrote, or null when it wrote none.
 */
async function hotUpdate(source: string): Promise<string | null> {
    const { vitePlugin } = await import('../src/unplugin.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-hmr-gate-'));
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

    const file = path.join(root, 'src/Card.tsx');
    fs.writeFileSync(file, source);
    const server = {
        config: { root },
        watcher: { emit() {} },
        moduleGraph: {
            getModuleById: () => null,
            invalidateModule() {},
            getModulesByFile: () => undefined,
        },
    };
    await call('hotUpdate', { file, server, modules: [] });
    const safelist = path.join(root, '.csszyx/csszyx-classes.txt');
    return fs.existsSync(safelist) ? fs.readFileSync(safelist, 'utf8') : null;
}

describe('hotUpdate reads a module through the transform gate', () => {
    it.each([
        ['an sz attribute', 'export const Card = () => <div sz={{ p: 4 }} />;'],
        [
            'an sz attribute with space around its `=`',
            'export const Card = () => <div sz = {{ p: 4 }} />;',
        ],
        ['a comment after the `=`', 'export const Card = () => <div sz=/* c */{{ p: 4 }} />;'],
    ])('lowers %s', async (_case, source) => {
        expect(await hotUpdate(source)).toContain('p-4');
    });

    it('records a module with no sz as contributing nothing', async () => {
        expect(await hotUpdate('export const Card = () => <div className="p-4" />;')).toBeNull();
    });
});
