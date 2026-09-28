import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { watch as chokidarWatch } from 'chokidar';
import { afterEach, describe, expect, it } from 'vitest';

import {
    classifyNativeEvent,
    type NextFileWatcher,
    watchRecursively,
} from '../src/commands/native-recursive-watcher.js';
import { chokidarNextWatchFactory, nextWatchFactoryFor } from '../src/commands/next-watch.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'csszyx-native-watch-')));
    tempDirs.push(dir);
    return dir;
}

const notIgnored = (): boolean => false;

/**
 * A stat that reports what the table says each path is.
 *
 * @param entries - Each path's kind, or the error reading it throws.
 * @returns The stat function.
 */
function statOf(entries: Record<string, 'file' | 'dir' | Error>) {
    return (path: string) => {
        const entry = entries[path];
        if (entry === undefined) {
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        if (entry instanceof Error) throw entry;
        return { isDirectory: () => entry === 'dir' };
    };
}

describe('classifyNativeEvent', () => {
    const root = join(tmpdir(), 'root');

    it.each([
        [
            'a file that exists',
            'app/Card.tsx',
            { [join(root, 'app/Card.tsx')]: 'file' as const },
            'change',
        ],
        ['a directory that exists', 'app', { [join(root, 'app')]: 'dir' as const }, 'addDir'],
        ['a file that is gone', 'app/Card.tsx', {}, 'unlink'],
        ['a directory that is gone', 'app', {}, 'unlinkDir'],
        // No extension, so it may have been a directory: both names prompt the
        // same reconciliation, and a dotfile has none either.
        ['a dotfile that is gone', 'app/.env', {}, 'unlinkDir'],
    ])('reads %s', (_name, filename, entries, event) => {
        expect(classifyNativeEvent(root, filename, notIgnored, statOf(entries))).toEqual({
            event,
            path: join(root, filename),
        });
    });

    it.each([
        ['no filename', null],
        ['an empty filename', ''],
    ])('reports %s as a rescan of the root', (_name, filename) => {
        // Node documents the name as not always provided. On the Windows
        // runner, writes made moments after the watch started arrived as one
        // nameless change and nothing else: dropping it lost them for good.
        const stat = () => {
            throw new Error('there is no path to stat');
        };
        expect(classifyNativeEvent(root, filename, notIgnored, stat)).toEqual({
            event: 'rescan',
            path: root,
        });
    });

    it('drops a name that leaves the root', () => {
        expect(
            classifyNativeEvent(root, join('..', 'elsewhere.tsx'), notIgnored, statOf({})),
        ).toBeNull();
    });

    it('drops what the ignore list prunes, before touching the disk', () => {
        const stat = () => {
            throw new Error('stat must not run for an ignored path');
        };
        expect(
            classifyNativeEvent(
                root,
                'node_modules/x/a.js',
                path => path.includes('node_modules'),
                stat,
            ),
        ).toBeNull();
    });

    it('reports a path it cannot stat as a change rather than dropping it', () => {
        // A reconciliation cycle costs a millisecond; a dropped event can leave
        // a stale shard for the rest of the session.
        const denied = Object.assign(new Error('EACCES'), { code: 'EACCES' });
        expect(
            classifyNativeEvent(
                root,
                'app/Card.tsx',
                notIgnored,
                statOf({ [join(root, 'app/Card.tsx')]: denied }),
            ),
        ).toEqual({ event: 'change', path: join(root, 'app/Card.tsx') });
    });
});

/**
 * Wait until `events` holds an entry that `match` accepts.
 *
 * @param events - Events recorded so far, still being appended to.
 * @param match - The entry being waited for.
 * @param timeoutMs - How long to wait before failing.
 */
async function waitForEvent(
    events: string[],
    match: (entry: string) => boolean,
    timeoutMs = 5000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (events.some(match)) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out; events: ${JSON.stringify(events)}`);
}

async function ready(watcher: NextFileWatcher): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        watcher.once('ready', () => resolve());
        watcher.once('error', reject);
    });
}

/**
 * Wait until the watcher is delivering, the way `next watch` does before it
 * starts: `ready` means the watch is registered, and on macOS the stream behind
 * it begins flowing a moment later — writes in between are dropped, not
 * delayed (measured: every event of a run lost, 3 runs in 8 under CPU load).
 *
 * @param watcher - A watcher that has reported `ready`.
 * @param root - Its root, where the probe is written.
 */
async function delivering(watcher: NextFileWatcher, root: string): Promise<void> {
    const probe = join(root, 'delivery-probe.txt');
    let seen = false;
    const onEvent = (): void => {
        seen = true;
    };
    watcher.on('all', onEvent);
    try {
        const deadline = Date.now() + 10_000;
        while (!seen && Date.now() < deadline) {
            writeFileSync(probe, String(Date.now()));
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (!seen) throw new Error('The watcher never delivered an event.');
    } finally {
        watcher.off('all', onEvent as (...args: unknown[]) => void);
        rmSync(probe, { force: true });
    }
}

// Chokidar runs only where `next watch` uses it. On macOS it loses exactly this
// case under load (7 of 120 runs on a Mac mini, 8 of 640 on CI runners), which
// is why the command does not use it there; asserting it there would only
// reproduce that.
const BACKENDS: ReadonlyArray<[string, (root: string) => NextFileWatcher]> = [
    ['native recursive', root => watchRecursively(root, { ignored: notIgnored })],
    ...(nextWatchFactoryFor() === chokidarNextWatchFactory
        ? [
              [
                  'chokidar',
                  (root: string) => chokidarWatch(root, { ignoreInitial: true, atomic: true }),
              ] as const,
          ]
        : []),
];

describe.each(BACKENDS)('the %s backend', (_name, start) => {
    it('reports a file written into a new directory, and its removal', async () => {
        // The case chokidar loses on macOS under load: a directory created while
        // the watch runs, with a file written into it at once.
        const root = tempRoot();
        const events: string[] = [];
        const watcher = start(root);
        watcher.on('all', (event, path) => events.push(`${event} ${path}`));
        await ready(watcher);
        await delivering(watcher, root);
        try {
            const target = join(root, 'app', 'Card.tsx');
            mkdirSync(join(root, 'app'));
            writeFileSync(target, 'export const Card = () => null;');
            await waitForEvent(
                events,
                entry => entry.endsWith(target) && !entry.startsWith('unlink'),
            );

            rmSync(target);
            await waitForEvent(events, entry => entry === `unlink ${target}`);
        } finally {
            await watcher.close();
        }
    }, 20_000);
});

describe('watchRecursively', () => {
    it('reports a removed directory as one', async () => {
        const root = tempRoot();
        mkdirSync(join(root, 'app'));
        const events: string[] = [];
        const watcher = watchRecursively(root, { ignored: notIgnored });
        watcher.on('all', (event, path) => events.push(`${event} ${path}`));
        await ready(watcher);
        await delivering(watcher, root);
        try {
            rmSync(join(root, 'app'), { recursive: true });
            await waitForEvent(events, entry => entry === `unlinkDir ${join(root, 'app')}`);
        } finally {
            await watcher.close();
        }
    }, 20_000);

    it('never reports a path the ignore list prunes', async () => {
        const root = tempRoot();
        const events: string[] = [];
        const watcher = watchRecursively(root, { ignored: path => path.includes('node_modules') });
        watcher.on('all', (event, path) => events.push(`${event} ${path}`));
        await ready(watcher);
        await delivering(watcher, root);
        try {
            mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
            writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), '');
            writeFileSync(join(root, 'App.tsx'), '');
            await waitForEvent(events, entry => entry.endsWith('App.tsx'));
            expect(events.filter(entry => entry.includes('node_modules'))).toEqual([]);
        } finally {
            await watcher.close();
        }
    }, 20_000);

    it('hands an error from the platform watcher to its listeners', async () => {
        const inner = Object.assign(new EventEmitter(), { close: () => {} });
        const watcher = watchRecursively(tempRoot(), { ignored: notIgnored }, () => inner as never);
        await ready(watcher);
        const seen = new Promise(resolve => watcher.once('error', resolve));
        inner.emit('error', new Error('EMFILE'));
        await expect(seen).resolves.toMatchObject({ message: 'EMFILE' });
        await watcher.close();
    });

    it('reports a watch that cannot start as an error, not a throw', async () => {
        const watcher = watchRecursively(tempRoot(), { ignored: notIgnored }, () => {
            throw new Error('ENOSPC');
        });
        await expect(
            new Promise((resolve, reject) => {
                watcher.once('ready', resolve);
                watcher.once('error', reject);
            }),
        ).rejects.toThrow('ENOSPC');
        await watcher.close();
    });
});
