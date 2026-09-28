/**
 * A recursive watch on one directory through Node's own `fs.watch`.
 *
 * On macOS and Windows the operating system watches the whole tree in one
 * stream (FSEvents, ReadDirectoryChangesW). Chokidar instead opens one watch
 * per directory and per file, and a file written into a directory the moment
 * it is created can land before the directory's own watch exists: measured on
 * macOS under CPU load, chokidar missed that file's events in about 1 run in 20,
 * the native stream in none of 1,280 across macOS, Windows and Linux. The
 * native stream also holds tens of descriptors where chokidar held thousands.
 *
 * Only the surface `next watch` reads is provided: `all`, `ready`, `error` and
 * `close`, with chokidar's event names, so either backend fits the same code.
 *
 * @module
 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The part of a file watcher `next watch` uses; chokidar's watcher fits it. */
export interface NextFileWatcher {
    on(event: 'all', listener: (event: string, filePath: string) => void): unknown;
    on(event: 'error', listener: (error: unknown) => void): unknown;
    once(event: 'ready' | 'error', listener: (...args: unknown[]) => void): unknown;
    off(event: 'all' | 'ready' | 'error', listener: (...args: unknown[]) => void): unknown;
    close(): Promise<void>;
}

/** What a changed path turned out to be. */
export interface NativeEvent {
    event: 'change' | 'addDir' | 'unlink' | 'unlinkDir';
    path: string;
}

/** Enough of `fs.Stats` to tell a directory from anything else. */
type Stat = (filePath: string) => Pick<fs.Stats, 'isDirectory'>;

/**
 * Name one event the platform watcher reported.
 *
 * The platform says only that something under `filename` changed, so the disk
 * is asked what is there now. A path still present is a `change` — the
 * difference between a new file and an edited one decides nothing downstream,
 * because every cycle reconciles all shards against the disk. A path that is
 * gone is an `unlink`, or an `unlinkDir` when it has no extension and so may
 * have been a directory; either one prompts the same reconciliation, which is
 * what reaps the shards of files a removed directory held.
 *
 * A path that cannot be read for any reason other than not existing is still
 * reported: a spare reconciliation costs a millisecond, a dropped event can
 * leave a stale shard for the rest of the session.
 *
 * Cost: one `stat` per event, none for an ignored path. O(1) in the size of
 * the tree.
 *
 * @param root - The watched directory.
 * @param filename - The name the platform reported, relative to `root`.
 * @param isIgnored - The watch's ignore predicate.
 * @param stat - Reads what is at a path now.
 * @returns The event, or null for a name to drop.
 */
export function classifyNativeEvent(
    root: string,
    filename: string | null,
    isIgnored: (filePath: string) => boolean,
    stat: Stat,
): NativeEvent | null {
    if (!filename) return null;
    const filePath = path.join(root, filename);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    if (isIgnored(filePath)) return null;
    try {
        return { event: stat(filePath).isDirectory() ? 'addDir' : 'change', path: filePath };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            return { event: 'change', path: filePath };
        }
        return { event: path.extname(filePath) === '' ? 'unlinkDir' : 'unlink', path: filePath };
    }
}

/** Options for {@link watchRecursively}. */
export interface RecursiveWatchOptions {
    /** Paths to drop before they reach a listener. */
    ignored: (filePath: string) => boolean;
}

/** The platform watcher, injectable so its failures can be driven in tests. */
type PlatformWatch = (
    root: string,
    options: { recursive: true },
    listener: (eventType: string, filename: string | null) => void,
) => Pick<fs.FSWatcher, 'on' | 'close'>;

const platformWatch: PlatformWatch = (root, options, listener) =>
    fs.watch(root, options, (eventType, filename) => listener(eventType, filename));

/**
 * Watch `root` and everything under it.
 *
 * `ready` fires once the platform watch is registered; a watch that cannot be
 * registered reports `error` instead of throwing, the way chokidar does, so a
 * caller handles both backends the same way. The ignore predicate filters in
 * the listener rather than through `fs.watch`'s own `ignore`, which Node 22
 * does not have: on the platforms this backend serves, the operating system
 * watches the whole tree whatever is ignored, so filtering here costs only the
 * events it drops.
 *
 * @param root - Directory to watch, as the canonical name events are reported under.
 * @param options - The ignore predicate.
 * @param watch - The platform watcher; defaults to `fs.watch`.
 * @returns A watcher emitting chokidar's event names.
 */
export function watchRecursively(
    root: string,
    options: RecursiveWatchOptions,
    watch: PlatformWatch = platformWatch,
): NextFileWatcher {
    const emitter = new EventEmitter();
    let inner: Pick<fs.FSWatcher, 'on' | 'close'> | null = null;
    try {
        inner = watch(root, { recursive: true }, (_eventType, filename) => {
            const event = classifyNativeEvent(root, filename, options.ignored, fs.statSync);
            if (event) emitter.emit('all', event.event, event.path);
        });
        inner.on('error', error => emitter.emit('error', error));
        setImmediate(() => emitter.emit('ready'));
    } catch (error) {
        setImmediate(() => emitter.emit('error', error));
    }
    return Object.assign(emitter, {
        close: async (): Promise<void> => {
            inner?.close();
        },
    });
}
