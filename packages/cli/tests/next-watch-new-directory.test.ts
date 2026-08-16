import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FSWatcher } from 'chokidar';
import { afterEach, describe, expect, it } from 'vitest';

import { startNextWatch } from '../src/commands/next-watch.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-cli-newdir-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"app","private":true}\n', 'utf8');
    writeFileSync(join(dir, 'src/App.tsx'), 'export const App=()=> <div sz={{ p: 4 }} />;');
    return dir;
}

/**
 * A watcher that reports a new directory but nothing inside it.
 *
 * This is not a hypothetical. CI recorded exactly this sequence: `addDir` for
 * a directory created a moment earlier, and no `add` for the file written into
 * it immediately afterwards. The file was never reported at all, so its later
 * removal was never reported either, and the shard it belonged to was never
 * reaped. On a loaded runner the two writes land inside the window before the
 * recursive watch on the new directory is established; a developer machine is
 * usually slow enough between the two calls to miss the race.
 *
 * Reproducing that with a real watcher costs a timing race that shows up in
 * roughly one CI run in five and never locally. Emitting the observed sequence
 * directly makes it exact.
 *
 * @param onAdd - Called with every path the session explicitly asks to watch.
 * @returns The watcher factory and the emitter used to drive it.
 */
function createDirectoryOnlyWatcher(onAdd: (paths: string | readonly string[]) => void): {
    factory: () => FSWatcher;
    emit: (event: string, path: string) => void;
} {
    const emitter = new EventEmitter();
    const watcher = Object.assign(emitter, {
        add: (paths: string | readonly string[]) => {
            onAdd(paths);
            return watcher;
        },
        close: async (): Promise<void> => {},
    }) as unknown as FSWatcher;

    return {
        factory: () => {
            setTimeout(() => emitter.emit('ready'), 0);
            return watcher;
        },
        emit: (event, path) => emitter.emit('all', event, path),
    };
}

describe('a directory that appears after the watcher started', () => {
    it('watches the source files already inside it', async () => {
        // Without this the file is invisible for the rest of the session: the
        // watcher never knew it existed, so deleting it produces no `unlink`,
        // `notifySourceRemoval` never runs, and the shard it wrote outlives the
        // source it came from.
        const root = tempRoot();
        const added: string[] = [];
        const { factory, emit } = createDirectoryOnlyWatcher(paths => {
            added.push(...(Array.isArray(paths) ? paths : [paths as string]));
        });

        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: factory, deliveryProbeTimeoutMs: 50 },
        );
        try {
            mkdirSync(join(root, 'app'), { recursive: true });
            writeFileSync(join(root, 'app/Card.tsx'), 'export const Card=()=> <div />;');

            emit('addDir', join(root, 'app'));

            expect(added).toContain(join(root, 'app/Card.tsx'));
        } finally {
            await session.close();
        }
    }, 30_000);

    it('leaves files that are not sources alone', async () => {
        const root = tempRoot();
        const added: string[] = [];
        const { factory, emit } = createDirectoryOnlyWatcher(paths => {
            added.push(...(Array.isArray(paths) ? paths : [paths as string]));
        });

        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: factory, deliveryProbeTimeoutMs: 50 },
        );
        try {
            mkdirSync(join(root, 'app'), { recursive: true });
            writeFileSync(join(root, 'app/notes.md'), '# not a source\n');
            writeFileSync(join(root, 'app/Card.tsx'), 'export const Card=()=> <div />;');

            emit('addDir', join(root, 'app'));

            expect(added).toContain(join(root, 'app/Card.tsx'));
            expect(added).not.toContain(join(root, 'app/notes.md'));
        } finally {
            await session.close();
        }
    }, 30_000);

    it('skips a file the ignore list prunes even when its directory is watched', async () => {
        // The directory is ordinary and gets read; one file inside it is not.
        // Without the per-file check the watcher would take an explicit watch
        // on a path the glob deliberately excludes.
        const root = tempRoot();
        const added: string[] = [];
        const { factory, emit } = createDirectoryOnlyWatcher(paths => {
            added.push(...(Array.isArray(paths) ? paths : [paths as string]));
        });

        const session = await startNextWatch(
            {
                root,
                cwd: root,
                parserMode: 'wasm',
                debounceMs: 10,
                silent: true,
                extraIgnore: ['app/generated.tsx'],
            },
            { watch: factory, deliveryProbeTimeoutMs: 50 },
        );
        try {
            mkdirSync(join(root, 'app'), { recursive: true });
            writeFileSync(join(root, 'app/generated.tsx'), 'export const G=()=> <div />;');
            writeFileSync(join(root, 'app/Card.tsx'), 'export const Card=()=> <div />;');

            emit('addDir', join(root, 'app'));

            expect(added).toContain(join(root, 'app/Card.tsx'));
            expect(added).not.toContain(join(root, 'app/generated.tsx'));
        } finally {
            await session.close();
        }
    }, 30_000);

    it('survives a directory that is gone by the time it is read', async () => {
        // The event and the read are not atomic. A build tool writing a
        // temporary tree, or a mkdir immediately undone, gets here with
        // nothing to read — an ordinary race, not a watcher failure, so it
        // must not reach the error channel that ends the session.
        const root = tempRoot();
        const added: string[] = [];
        const { factory, emit } = createDirectoryOnlyWatcher(paths => {
            added.push(...(Array.isArray(paths) ? paths : [paths as string]));
        });

        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: factory, deliveryProbeTimeoutMs: 50 },
        );
        try {
            emit('addDir', join(root, 'never-existed'));

            expect(added).toEqual([]);
            // The session is still usable, which is the point of swallowing it.
            expect(existsSync(session.safelistOutputPath)).toBe(true);
        } finally {
            await session.close();
        }
    }, 30_000);

    it('does not walk a directory it was told to ignore', async () => {
        // `node_modules` is in the default ignore list. Rescanning it would
        // walk a tree orders of magnitude larger than the app for nothing.
        const root = tempRoot();
        const added: string[] = [];
        const { factory, emit } = createDirectoryOnlyWatcher(paths => {
            added.push(...(Array.isArray(paths) ? paths : [paths as string]));
        });

        const session = await startNextWatch(
            { root, cwd: root, parserMode: 'wasm', debounceMs: 10, silent: true },
            { watch: factory, deliveryProbeTimeoutMs: 50 },
        );
        try {
            mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
            writeFileSync(join(root, 'node_modules/pkg/index.tsx'), 'export const x=1;');

            emit('addDir', join(root, 'node_modules/pkg'));

            expect(added).toEqual([]);
        } finally {
            await session.close();
        }
    }, 30_000);
});
