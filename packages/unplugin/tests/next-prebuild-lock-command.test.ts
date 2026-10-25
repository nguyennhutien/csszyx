/**
 * What a prebuild records on the safelist state lock, and how `next watch`
 * materializes at startup.
 *
 * The Turbopack loader steps aside only for a lock recorded under the watcher's
 * command, because a watcher's next cycle reads every shard the loader wrote
 * while it waited. A standalone `next prebuild` has no cycle after it, so it
 * keeps its own name and the loader refuses to yield to it. `next watch` writes
 * the shards without materializing, then runs the watcher's own cycle, which
 * steps aside when the loader holds the lock.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const lockCommands = vi.hoisted(() => [] as (string | undefined)[]);

vi.mock('../src/next-watcher-cycle.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/next-watcher-cycle.js')>();
    return {
        ...actual,
        runNextWatcherCycle: (...args: Parameters<typeof actual.runNextWatcherCycle>) => {
            lockCommands.push(args[1]?.lockOptions?.command);
            return actual.runNextWatcherCycle(...args);
        },
    };
});

import { runNextPrebuild, writeNextPrebuildShards } from '../src/next-prebuild.js';
import {
    acquireNextSafelistStateLock,
    NEXT_PREBUILD_LOCK_COMMAND,
    NEXT_TURBO_LOADER_LOCK_COMMAND,
    NextSafelistStateLockedError,
} from '../src/next-safelist-state.js';
import { runNextWatcherCycleUnlessLoaderHolds } from '../src/next-watcher-cycle.js';

const tempDirs: string[] = [];

afterEach(() => {
    lockCommands.length = 0;
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * @returns A project with one source file carrying an sz prop.
 */
function project(): { root: string; file: string } {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-prebuild-lock-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    const file = join(root, 'src/App.tsx');
    writeFileSync(file, 'export const App=()=> <div sz={{ p: 4 }} />;', 'utf8');
    return { root, file };
}

/**
 * @param root - Project root.
 * @param file - The one source file.
 * @returns Options for a development prebuild of that file.
 */
function options(root: string, file: string) {
    return {
        files: [file],
        explicitRoot: root,
        cwd: root,
        config: { mangleVars: false },
        nextVersion: '16.2.7',
        csszyxVersion: '0.9.0',
        compilerVersion: '0.9.0',
        nativeVersion: '0.9.0-test',
        mode: 'development' as const,
        writeOptions: { retryDelayMs: 0 },
        warn: () => {},
    };
}

describe('next prebuild lock command', () => {
    it('records its own command when it runs on its own', () => {
        const { root, file } = project();

        runNextPrebuild(options(root, file));

        expect(lockCommands).toEqual(['csszyx next prebuild']);
    });

    it('writes the shards without materializing when asked for them alone', () => {
        const { root, file } = project();

        const shards = writeNextPrebuildShards(options(root, file));

        expect(lockCommands).toEqual([]);
        expect(shards.files).toHaveLength(1);
        expect(shards.transformedCount).toBe(1);
    });
});

describe('the watcher cycle at startup', () => {
    /**
     * @param command - Who holds the lock.
     * @returns The shards' context and a release for the lock.
     */
    function heldBy(command: string) {
        const { root, file } = project();
        const { context } = writeNextPrebuildShards(options(root, file));
        const lock = acquireNextSafelistStateLock(join(context.cacheDir, 'state.lock'), {
            root: context.root,
            mode: 'development',
            command,
        });
        return { context, lock };
    }

    it('steps aside for the loader, and runs once it lets go', () => {
        const { context, lock } = heldBy(NEXT_TURBO_LOADER_LOCK_COMMAND);
        try {
            expect(runNextWatcherCycleUnlessLoaderHolds(context)).toBeNull();
        } finally {
            lock.release();
        }
        expect(runNextWatcherCycleUnlessLoaderHolds(context)?.materialize.classes).toContain('p-4');
    });

    it('still throws for any other holder', () => {
        const { context, lock } = heldBy(NEXT_PREBUILD_LOCK_COMMAND);
        try {
            expect(() => runNextWatcherCycleUnlessLoaderHolds(context)).toThrow(
                NextSafelistStateLockedError,
            );
        } finally {
            lock.release();
        }
    });
});
