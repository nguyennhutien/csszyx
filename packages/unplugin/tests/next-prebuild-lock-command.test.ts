/**
 * What a prebuild records on the safelist state lock.
 *
 * The Turbopack loader steps aside only for a lock recorded under the watcher's
 * command, because a watcher's next cycle reads every shard the loader wrote
 * while it waited. `next watch` runs a prebuild at startup and its initial cycle
 * follows, so that prebuild has to record the watcher's command: under its own
 * name the loader treated it as a stranger and failed the compile when the two
 * overlapped. A standalone `next prebuild` has no cycle after it, so it keeps its
 * own name and the loader still refuses to yield to it.
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

import { runNextPrebuild } from '../src/next-prebuild.js';
import { NEXT_WATCH_LOCK_COMMAND } from '../src/next-safelist-state.js';

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

    it("records the watcher's command when next watch runs it at startup", () => {
        const { root, file } = project();

        runNextPrebuild({ ...options(root, file), lockCommand: NEXT_WATCH_LOCK_COMMAND });

        expect(lockCommands).toEqual([NEXT_WATCH_LOCK_COMMAND]);
    });
});
