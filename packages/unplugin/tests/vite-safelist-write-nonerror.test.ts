/**
 * A thrown value that is not an `Error` still has to reach the reader.
 *
 * `String(error)` is the only thing between a developer and the word
 * `undefined` in place of a reason. Nothing in the real write path throws a
 * bare value, so the module doing the writing is replaced here — the branch is
 * defensive, and a defensive branch nobody exercises is a branch that stops
 * working without anyone noticing.
 *
 * In its own file because the mock replaces the writer for every test in a
 * file, and the tests next door need the real one to observe what it does to a
 * symlink.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/atomic-write.js', () => ({
    atomicWriteFileSync: (): never => {
        throw 'the disk said no';
    },
    atomicRenameWithRetry: (): void => {},
}));

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('a writer that throws something other than an Error', () => {
    it('puts the thrown value in the warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { vitePlugin } = await import('../src/unplugin.js');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-nonerror-'));
        tempDirs.push(root);
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });

        const plugins = vitePlugin({});
        const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
        const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
            const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
            const hook = (plugin as Record<string, unknown> | undefined)?.[hookName];
            const fn = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as ((...a: unknown[]) => unknown) | undefined;
            return fn ? await fn.apply(ctx, args) : undefined;
        };
        await call('configResolved', { root, command: 'serve' });

        const file = path.join(root, 'src/Card.tsx');
        fs.writeFileSync(file, 'export const Card = () => <div sz={{ p: 4 }} />;');
        const moduleGraph = {
            getModuleById: () => null,
            invalidateModule() {},
            getModulesByFile: () => undefined,
        };
        await call('hotUpdate', {
            type: 'update',
            file,
            modules: [],
            server: {
                config: { root },
                watcher: { emit() {} },
                ws: { send() {} },
                moduleGraph,
                environments: { client: { moduleGraph } },
            },
        });

        const said = warn.mock.calls.map(entry => String(entry[0])).join('\n');
        expect(said).toContain('could not write the generated safelist');
        expect(said).toContain('the disk said no');
    });
});
