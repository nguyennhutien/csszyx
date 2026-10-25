/**
 * `next watch` and `next dev` start together, so the Turbopack loader can hold
 * the safelist state lock at the moment the watcher materializes for the first
 * time. That is the loader's turn, not a failure: the watcher's initial cycle,
 * queued behind the lock, reads every shard once the loader lets go. Thrown,
 * it ended the watch, and `concurrently --kill-others-on-fail` stopped
 * `next dev` with it.
 */
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FSWatcher } from 'chokidar';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    acquireNextSafelistStateLock,
    NEXT_TURBO_LOADER_LOCK_COMMAND,
} from '../../unplugin/src/next-safelist-state.js';

import { startNextWatch } from '../src/commands/next-watch.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * @returns A Next app with one page carrying an sz prop.
 */
function app(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'csszyx-nw-lock-'));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, 'app'), { recursive: true });
    writeFileSync(join(cwd, 'package.json'), '{"name":"a","private":true}\n');
    writeFileSync(join(cwd, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;');
    return cwd;
}

/**
 * @returns A fake chokidar watcher that only reports readiness.
 */
function readyWatcher(): never {
    const emitter = new EventEmitter();
    const fake = emitter as unknown as FSWatcher;
    (fake as unknown as { close: () => Promise<void> }).close = async () => {};
    return ((..._args: unknown[]) => {
        queueMicrotask(() => emitter.emit('ready'));
        return fake;
    }) as never;
}

describe('next watch startup', () => {
    it('writes the safelist at startup', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = app();

        const session = await startNextWatch(
            { cwd, parserMode: 'wasm', outputFile: 'safelist.css' },
            { watch: readyWatcher() },
        );
        try {
            expect(readFileSync(join(cwd, 'safelist.css'), 'utf8')).toContain('p-4');
        } finally {
            await session.close();
        }
    }, 15000);

    it('waits for a loader holding the lock instead of ending, then writes the safelist', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = app();
        const lock = acquireNextSafelistStateLock(join(cwd, '.csszyx/cache/state.lock'), {
            root: cwd,
            mode: 'development',
            command: NEXT_TURBO_LOADER_LOCK_COMMAND,
        });

        let session: Awaited<ReturnType<typeof startNextWatch>>;
        try {
            session = await startNextWatch(
                { cwd, parserMode: 'wasm', outputFile: 'safelist.css' },
                { watch: readyWatcher() },
            );
            expect(existsSync(join(cwd, 'safelist.css'))).toBe(false);
        } finally {
            lock.release();
        }
        try {
            await vi.waitFor(
                () => expect(readFileSync(join(cwd, 'safelist.css'), 'utf8')).toContain('p-4'),
                { timeout: 5000, interval: 20 },
            );
        } finally {
            await session.close();
        }
    }, 15000);
});
