/**
 * next-watch failure-normalization branch: a chokidar watcher that reports a
 * non-Error runtime failure (a bare string) must still surface as an Error on the
 * session's failure promise, exercising the `error instanceof Error ? … : new
 * Error(String(error))` fallback inside startNextWatch's reportFailure.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
