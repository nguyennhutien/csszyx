/**
 * A module the sz pass does not lower reaches the safelist through the regex
 * fallback (`extractClasses` → `addSafelistClasses`), which reads its quoted
 * `className` strings. A class holding a BOM (not White_Space, so the engine
 * keeps it inside the class) is safelisted whole, as the runtime and the
 * engine read it, through the real Vite plugin: transform the module in dev,
 * then let an `sz` edit write the safelist the way a dev server does.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const BOM_CLASS = 'content-[a﻿b]';

/**
 * Serve a project, transform one module with no `sz`, then hot-update an `sz`
 * module with a new class so the safelist is written.
 *
 * @param source - The module with no `sz`.
 * @returns The safelist's class lines.
 */
async function safelistAfter(source: string): Promise<string[]> {
    const { vitePlugin } = await import('../src/unplugin.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-fallback-list-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    const plugins = vitePlugin({});
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const call = async (self: object, hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        const hook = (plugin as Record<string, unknown> | undefined)?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(self, args) : undefined;
    };
    await call(ctx, 'configResolved', { root, command: 'serve' });
    await call(ctx, 'transform', '@import "tailwindcss";', path.join(root, 'src/index.css'));

    await call(ctx, 'transform', source, path.join(root, 'src/Plain.tsx'));

    const card = path.join(root, 'src/Card.tsx');
    fs.writeFileSync(card, 'export const Card = () => <div sz={{ m: 7 }} />;');
    const moduleGraph = { getModulesByFile: () => undefined, getModuleById: () => null };
    const server = {
        config: { root },
        watcher: { emit() {} },
        ws: { send() {} },
        moduleGraph,
        environments: { client: { moduleGraph } },
    };
    const client = { ...ctx, environment: { name: 'client', moduleGraph } };
    await call(client, 'hotUpdate', { type: 'update', file: card, modules: [], server });

    const safelist = fs.readFileSync(path.join(root, '.csszyx/csszyx-classes.txt'), 'utf8');
    return safelist.split('\n').filter(line => line && !line.startsWith('#'));
}

describe('the safelist the regex fallback feeds', () => {
    it.each([
        ['a quoted className', `export const P = () => <div className="${BOM_CLASS} p-4" />;`],
        [
            'a className expression',
            `export const P = ({ on }) => <div className={on ? "${BOM_CLASS} p-4" : "p-2"} />;`,
        ],
    ])('names a class holding a BOM whole, from %s', async (_what, source) => {
        const lines = await safelistAfter(source);
        expect(lines).toContain('m-7');
        expect(lines).toContain(BOM_CLASS);
        expect(lines).toContain('p-4');
        expect(lines).not.toContain('content-[a');
        expect(lines).not.toContain('b]');
    });
});
