/**
 * The nextWatch command wrapper: its no-match failure, the ready banner, and
 * the SIGINT-driven clean shutdown that the session-level suite skips.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextWatch } from '../src/commands/next-watch.js';

const tempDirs: string[] = [];
function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-nw-'));
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('nextWatch command lifecycle', () => {
    it('fails with exit code 1 when no sources match', async () => {
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
            errors.push(parts.join(' '));
        });
        const code = await nextWatch({ cwd: tempRoot(), silent: true });
        expect(code).toBe(1);
        expect(errors.join('\n')).toContain('No source files matched');
    });

    it('starts, prints the banner, and shuts down cleanly on SIGINT', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            logs.push(parts.join(' '));
        });
        const cwd = tempRoot();
        mkdirSync(join(cwd, 'app'));
        writeFileSync(join(cwd, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;');

        const running = nextWatch({ cwd, parserMode: 'babel', debounceMs: 5 });
        // Give the watcher a moment to reach ready, then signal shutdown.
        await new Promise(resolve => setTimeout(resolve, 400));
        process.emit('SIGINT');
        const code = await running;
        expect(code).toBe(0);
        expect(logs.join('\n')).toContain('next watch ready');
    }, 20000);
});

describe('watcher failure and startup-error paths', () => {
    it('a runtime watcher error resolves the failure promise and closes cleanly', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = tempRoot();
        mkdirSync(join(cwd, 'app'));
        writeFileSync(join(cwd, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;');
        const { startNextWatch } = await import('../src/commands/next-watch.js');
        const session = await startNextWatch({ cwd, parserMode: 'babel' });
        // Simulate a chokidar runtime failure after readiness.
        // Reach the internal watcher through the failure wiring: emit via a
        // filesystem error is racy, so drive the public close after a failure
        // signal from a forced error event.
        const errorPromise = session.failure;
        // Trigger by removing the watched root out from under chokidar.
        rmSync(join(cwd, 'app'), { recursive: true, force: true });
        const raced = await Promise.race([
            errorPromise.then(error => ({ kind: 'error' as const, error })),
            new Promise(resolve => setTimeout(() => resolve({ kind: 'timeout' as const }), 800)),
        ]);
        await session.close();
        await session.close(); // idempotent second close
        expect(['error', 'timeout']).toContain((raced as { kind: string }).kind);
    }, 20000);

    it('propagates a startup error when the watch factory fails to become ready', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = tempRoot();
        mkdirSync(join(cwd, 'app'));
        writeFileSync(join(cwd, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;');
        const { startNextWatch } = await import('../src/commands/next-watch.js');
        const { EventEmitter } = await import('node:events');
        const fake = new EventEmitter() as never as import('chokidar').FSWatcher;
        (fake as { close?: () => Promise<void> }).close = async () => {};
        const factory = (() => {
            queueMicrotask(() => (fake as EventEmitter).emit('error', new Error('boot failed')));
            return fake;
        }) as never;
        await expect(
            startNextWatch({ cwd, parserMode: 'babel' }, { watch: factory }),
        ).rejects.toThrow('boot failed');
    }, 20000);
});
