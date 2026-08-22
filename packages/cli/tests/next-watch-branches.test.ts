/**
 * next-watch failure-normalization branch: a chokidar watcher that reports a
 * non-Error runtime failure (a bare string) must still surface as an Error on the
 * session's failure promise, exercising the `error instanceof Error ? … : new
 * Error(String(error))` fallback inside startNextWatch's reportFailure.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FSWatcher } from 'chokidar';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startNextWatch } from '../src/commands/next-watch.js';

const tempDirs: string[] = [];
function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-nw-br-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"a","private":true}\n');
    writeFileSync(join(dir, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;');
    return dir;
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('startNextWatch failure normalization', () => {
    it('wraps a non-Error watcher failure into an Error on the failure promise', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = tempRoot();

        // A fake chokidar watcher we can drive: ready first, then a string failure.
        const emitter = new EventEmitter();
        const fake = emitter as unknown as FSWatcher;
        (fake as unknown as { close: () => Promise<void> }).close = async () => {};
        const factory = ((..._args: unknown[]) => {
            queueMicrotask(() => emitter.emit('ready'));
            return fake;
        }) as never;

        const session = await startNextWatch({ cwd, parserMode: 'wasm' }, { watch: factory });
        // Emit a NON-Error runtime failure — reportFailure must wrap it.
        emitter.emit('error', 'raw string failure');
        const error = await session.failure;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('raw string failure');
        await session.close();
    }, 15000);
});

describe('the watch root is registered under its canonical name', () => {
    // On Windows the temp directory GitHub runners use, and any project path
    // reached through an 8.3 short name, a junction or `subst`, is not the
    // name the filesystem reports events under. libuv (Node 24.16+, libuv
    // 1.52) keeps the registered directory verbatim and asserts that every
    // event's long name starts with it — an assert, so the process aborts
    // with nothing in any log the first time a folder is deleted under the
    // watcher. Registering the canonical name is what removes the mismatch.
    it('hands the watcher the resolved root, not the spelling it was given', async () => {
        const cwd = tempRoot();
        // A real link so both spellings reach the same files: `site` is the
        // name given, `site-canonical` is what the filesystem reports.
        const canonical = join(cwd, 'site-canonical');
        mkdirSync(join(canonical, 'app'), { recursive: true });
        writeFileSync(
            join(canonical, 'app/page.tsx'),
            'export default () => <div sz={{ p: 4 }} />;',
        );
        const given = join(cwd, 'site');
        symlinkSync(canonical, given, 'junction');
        let registered: string | undefined;
        const emitter = new EventEmitter();
        const factory = ((root: string) => {
            registered = root;
            queueMicrotask(() => emitter.emit('ready'));
            return Object.assign(emitter, { close: async () => {} }) as never;
        }) as never;

        const session = await startNextWatch(
            { cwd, root: given, parserMode: 'wasm' },
            {
                watch: factory,
                deliveryProbeTimeoutMs: 1,
                realpath: p => (p === given ? canonical : p),
            },
        );
        await session.close();

        expect(registered).toBe(canonical);
        expect(session.root).toBe(canonical);
    });
});

describe('canonicalWatchRoot', () => {
    it('keeps the given spelling off Windows', async () => {
        const { canonicalWatchRoot } = await import('../src/commands/next-watch.js');
        const given = tmpdir();
        if (process.platform === 'win32') return;

        expect(canonicalWatchRoot(given)).toBe(given);
    });

    it('resolves to the final name on Windows, and keeps the spelling when it cannot', async () => {
        const { canonicalWatchRoot } = await import('../src/commands/next-watch.js');
        if (process.platform !== 'win32') return;

        // On a hosted runner `tmpdir()` is an 8.3 short name; the final name
        // is the long form, which is the whole point of the function.
        const resolved = canonicalWatchRoot(tmpdir());
        expect(resolved).not.toContain('~');
        expect(canonicalWatchRoot('Z:\\definitely\\missing\\root')).toBe(
            'Z:\\definitely\\missing\\root',
        );
    });
});
