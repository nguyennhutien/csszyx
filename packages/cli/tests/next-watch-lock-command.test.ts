/**
 * `next watch` runs a prebuild at startup, and the Turbopack loader steps aside
 * only for a lock recorded under the watcher's command. Under the prebuild's own
 * name, a loader compile that landed on it failed the page. The watch command
 * therefore hands its own command to that prebuild; its initial cycle, which
 * follows, reads every shard the loader wrote in the meantime.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FSWatcher } from 'chokidar';
import { afterEach, describe, expect, it, vi } from 'vitest';

const prebuildCommands = vi.hoisted(() => [] as (string | undefined)[]);

vi.mock('@csszyx/unplugin/next-prebuild', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/unplugin/next-prebuild')>();
    return {
        ...actual,
        runNextPrebuild: (options: Parameters<typeof actual.runNextPrebuild>[0]) => {
            prebuildCommands.push((options as { lockCommand?: string }).lockCommand);
            return actual.runNextPrebuild(options);
        },
    };
});

import { startNextWatch } from '../src/commands/next-watch.js';

const tempDirs: string[] = [];

afterEach(() => {
    prebuildCommands.length = 0;
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('next watch startup prebuild', () => {
    it("records the watcher's command on the lock, so the loader steps aside", async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const cwd = mkdtempSync(join(tmpdir(), 'csszyx-nw-lock-'));
        tempDirs.push(cwd);
        mkdirSync(join(cwd, 'app'), { recursive: true });
        writeFileSync(join(cwd, 'package.json'), '{"name":"a","private":true}\n');
        writeFileSync(join(cwd, 'app/page.tsx'), 'export default () => <div sz={{ p: 4 }} />;');

        // A fake chokidar watcher that only reports readiness.
        const emitter = new EventEmitter();
        const fake = emitter as unknown as FSWatcher;
        (fake as unknown as { close: () => Promise<void> }).close = async () => {};
        const factory = ((..._args: unknown[]) => {
            queueMicrotask(() => emitter.emit('ready'));
            return fake;
        }) as never;

        const session = await startNextWatch({ cwd, parserMode: 'wasm' }, { watch: factory });
        try {
            expect(prebuildCommands).toEqual(['csszyx next watch']);
        } finally {
            await session.close();
        }
    }, 15000);
});
