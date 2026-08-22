/**
 * csszyx next-watch - Maintain the Next.js Turbopack Tailwind safelist.
 *
 * Startup runs the existing prebuild contract once. Chokidar then observes
 * metadata shards plus source removals; source add/change transforms remain
 * owned by the Turbopack loader so the CLI does not duplicate compiler work.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { runNextPrebuild } from '@csszyx/unplugin/next-prebuild';
import { type NextSafelistWatchEvent, NextSafelistWatcher } from '@csszyx/unplugin/next-watcher';
import { type ChokidarOptions, type FSWatcher, watch } from 'chokidar';
import fg from 'fast-glob';
import { Minimatch } from 'minimatch';
import { withPosixSeparators } from '../utils/posix-path.js';
import { colors, icons } from '../utils/terminal-ui.js';
import { DEFAULT_NEXT_SOURCE_IGNORE, DEFAULT_NEXT_SOURCE_PATTERN } from './next-patterns.js';

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/i;
const WINDOWS_PATH_SEPARATOR = String.fromCodePoint(92);

/** Options accepted by the `next-watch` CLI command. */
export interface NextWatchCommandOptions {
    cwd?: string;
    root?: string;
    parserMode?: 'rust' | 'wasm';
    outputFile?: string;
    cacheDir?: string;
    pattern?: string;
    extraIgnore?: readonly string[];
    importedStaticSz?: boolean;
    debounceMs?: number | string;
    silent?: boolean;
}

/**
 * The name the filesystem will report events under for `root`.
 *
 * On Windows a path can be spelled several ways for one directory: an 8.3
 * short name (`C:\\Users\\RUNNER~1`, which is what `%TEMP%` gives on GitHub's
 * runners), a junction, a `subst` drive. libuv records the directory exactly
 * as registered, long-paths every event it receives, and then asserts that
 * the event's name starts with the registered one — an assert, not an error,
 * so the first deleted folder under the watcher aborts the process with
 * nothing in any log (Node 24.16+ / libuv 1.52; the upstream fix is merged
 * and not yet in a Node release). Registering the canonical name is what
 * removes the mismatch, and it is what Vite does for the same reason.
 *
 * Windows only: on macOS the canonical name differs for the temp directory
 * (`/var` is a link to `/private/var`), and nothing there asserts, so the
 * spelling the user gave is kept as the one they will see in output.
 *
 * A root that cannot be resolved — a mapped network drive that refuses the
 * final-path query, a RAM disk — is watched under the name given: a watcher
 * that starts is worth more than one that refuses to.
 *
 * @param root Absolute watch root as given.
 * @returns The root to register with the watcher.
 */
export function canonicalWatchRoot(root: string): string {
    if (process.platform !== 'win32') return root;
    try {
        return fs.realpathSync.native(root);
    } catch {
        return root;
    }
}

/** Minimal watcher factory kept injectable for lifecycle tests. */
export type NextWatchFactory = (
    paths: string | readonly string[],
    options: ChokidarOptions,
) => FSWatcher;

/** Dependencies that can be replaced by tests. */
export interface NextWatchDependencies {
    watch?: NextWatchFactory;
    /**
     * Resolve the watch root to the name the filesystem reports events under.
     * Present so the canonicalisation can be driven from a test on any host;
     * the default is {@link canonicalWatchRoot}.
     */
    realpath?: (root: string) => string;
    /**
     * How long to wait for the watcher to report the readiness probe before
     * starting anyway. Present so tests can reach the give-up path without
     * spending the real budget on it.
     */
    deliveryProbeTimeoutMs?: number;
}

/**
 * Name of the file written to prove the watcher delivers events.
 *
 * The shard reader only takes `*.json`, so this never reads as a shard even in
 * the window before it is removed.
 */
const DELIVERY_PROBE_NAME = '.csszyx-watch-probe';

/** How long readiness waits on the probe before giving up and starting. */
const DELIVERY_PROBE_TIMEOUT_MS = 2000;

/** Active Next watcher session. */
export interface NextWatchSession {
    root: string;
    sourcePattern: string;
    safelistOutputPath: string;
    manifestPath: string;
    failure: Promise<Error>;
    close: () => Promise<void>;
}

/**
 * Start one prebuilt, chokidar-backed Next safelist watcher.
 *
 * @param options Command options.
 * @param dependencies Injectable watcher factory.
 * @returns Active session after chokidar is ready and state is materialized.
 */
export async function startNextWatch(
    options: NextWatchCommandOptions = {},
    dependencies: NextWatchDependencies = {},
): Promise<NextWatchSession> {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const root = (dependencies.realpath ?? canonicalWatchRoot)(path.resolve(options.root ?? cwd));
    const pattern = withPosixSeparators(options.pattern ?? DEFAULT_NEXT_SOURCE_PATTERN);
    const ignore = [...DEFAULT_NEXT_SOURCE_IGNORE, ...(options.extraIgnore ?? [])];
    const parserMode = normalizeParserMode(options.parserMode);
    const debounceMs = normalizeDebounceMs(options.debounceMs);
    const files = await fg(pattern, {
        cwd: root,
        absolute: true,
        ignore,
        dot: false,
        onlyFiles: true,
    });

    if (files.length === 0) {
        throw new Error(`No source files matched pattern \`${pattern}\` under ${root}.`);
    }

    const prebuild = runNextPrebuild({
        files,
        explicitRoot: root,
        cwd,
        mode: 'development',
        parserMode,
        safelistOutputFile: options.outputFile,
        cacheDir: options.cacheDir,
        importedStaticSz: options.importedStaticSz,
        config: { mangleVars: false },
    });

    let resolveFailure: (error: Error) => void = () => {};
    let failed = false;
    const failure = new Promise<Error>(resolve => {
        resolveFailure = resolve;
    });
    const reportFailure = (error: unknown): void => {
        if (failed) {
            return;
        }
        failed = true;
        resolveFailure(error instanceof Error ? error : new Error(String(error)));
    };

    const controller = new NextSafelistWatcher({
        context: prebuild.context,
        debounceMs,
        onError: reportFailure,
    });
    const isIgnored = createIgnoredMatcher(root, prebuild.context.safelist.shardsDir, ignore);
    const watchFactory = dependencies.watch ?? watch;
    const fsWatcher = watchFactory(root, {
        ignoreInitial: true,
        persistent: true,
        atomic: true,
        awaitWriteFinish: {
            stabilityThreshold: 25,
            pollInterval: 10,
        },
        ignored: isIgnored,
    });

    const probePath = path.join(
        path.resolve(prebuild.context.safelist.shardsDir),
        DELIVERY_PROBE_NAME,
    );

    fsWatcher.on('all', (event, filePath) => {
        const absolutePath = path.resolve(filePath);
        if (absolutePath === probePath) {
            return;
        }
        // A directory that appears after the watch is running may already hold
        // files, and the recursive watch on it is established AFTER it exists.
        // Anything written into that window is never reported — and never
        // reported means the watcher does not know the file at all, so its
        // eventual removal produces no `unlink` either and the shard it wrote
        // outlives its source. Naming the files explicitly closes the window;
        // a path chokidar already tracks is a no-op.
        if (event === 'addDir') {
            watchSourcesAlreadyInside(fsWatcher, absolutePath, isIgnored);
            return;
        }
        if (event === 'add' || event === 'change' || event === 'unlink') {
            if (
                controller.notify(event as NextSafelistWatchEvent, absolutePath) ||
                event !== 'unlink' ||
                !SOURCE_EXTENSION.test(absolutePath)
            ) {
                return;
            }
            controller.notifySourceRemoval(absolutePath);
        }
    });
    fsWatcher.on('error', reportFailure);

    try {
        await waitForWatcherReady(fsWatcher);
        await waitForWatcherDelivery(
            fsWatcher,
            probePath,
            dependencies.deliveryProbeTimeoutMs ?? DELIVERY_PROBE_TIMEOUT_MS,
        );
        controller.start();
    } catch (error) {
        await fsWatcher.close();
        controller.close();
        throw error;
    }

    let closed = false;
    return {
        root,
        sourcePattern: pattern,
        safelistOutputPath: prebuild.safelistOutputPath,
        manifestPath: prebuild.manifestPath,
        failure,
        close: async () => {
            if (closed) {
                return;
            }
            closed = true;
            await fsWatcher.close();
            controller.close();
        },
    };
}

/**
 * Run the Next watcher until SIGINT/SIGTERM or a fatal watcher error.
 *
 * @param options Command options.
 * @returns Exit code (0 for signal shutdown, 1 for startup/runtime failure).
 */
export async function nextWatch(options: NextWatchCommandOptions = {}): Promise<number> {
    let session: NextWatchSession | undefined;
    let exitCode = 0;
    try {
        session = await startNextWatch(options);
        if (!options.silent) {
            console.log(`${colors.success(icons.success)} csszyx next watch ready`);
            console.log(`  root:     ${session.root}`);
            console.log(`  pattern:  ${session.sourcePattern}`);
            console.log(`  safelist: ${session.safelistOutputPath}`);
            console.log(`  manifest: ${session.manifestPath}`);
        }

        const outcome = await waitForShutdown(session.failure);
        if (outcome) {
            console.error(`${colors.error(icons.error)} ${outcome.message}`);
            exitCode = 1;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${colors.error(icons.error)} ${message}`);
        exitCode = 1;
    }

    try {
        await session?.close();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${colors.error(icons.error)} Failed to close Next watcher: ${message}`);
        exitCode = 1;
    }
    return exitCode;
}

/**
 *
 * @param watcher Chokidar watcher awaiting initial readiness.
 * @returns Promise resolved after the initial scan or rejected on startup error.
 */
function waitForWatcherReady(watcher: FSWatcher): Promise<void> {
    return new Promise((resolve, reject) => {
        const onReady = (): void => {
            watcher.off('error', onStartupError);
            resolve();
        };
        const onStartupError = (error: unknown): void => {
            watcher.off('ready', onReady);
            reject(error);
        };
        watcher.once('ready', onReady);
        watcher.once('error', onStartupError);
    });
}

/**
 * Wait until the watcher proves it is delivering events.
 *
 * A watcher's `ready` means its first scan finished, not that the operating
 * system has started reporting changes. On macOS the recursive watch is
 * registered before the stream behind it begins flowing, and writes made in
 * between are not delayed — they are dropped, with nothing to replay them.
 * Announcing readiness there means a source edit made moments after startup
 * never reaches the safelist, so its classes never reach the stylesheet and the
 * page renders without them, silently. Watching a file this function creates
 * turns readiness into something the watcher has to demonstrate.
 *
 * Giving up is deliberate: a watcher that cannot report its own probe is
 * already degraded, and refusing to start would take away the prebuilt safelist
 * the session had produced regardless.
 *
 * @param watcher Watcher that has finished its initial scan.
 * @param probePath File to create and wait for.
 * @param timeoutMs How long to wait before starting anyway.
 */
async function waitForWatcherDelivery(
    watcher: FSWatcher,
    probePath: string,
    timeoutMs: number,
): Promise<void> {
    await new Promise<void>(resolve => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        // Every step here is idempotent, so the two callers race harmlessly.
        // `clearTimeout` accepts undefined, which spares a guard for a state
        // no caller can reach: the timer is armed before either of them runs.
        const finish = (): void => {
            clearTimeout(timer);
            watcher.off('all', onEvent);
            resolve();
        };
        // Any event at all, not only the probe's: what is being waited on is
        // the pipe carrying events, and anything arriving through it proves
        // that. `ignoreInitial` means nothing is replayed for files that were
        // already there, so an event here is always a real change. The probe
        // is what guarantees one will come, not what makes it count.
        const onEvent = (): void => {
            finish();
        };

        watcher.on('all', onEvent);
        timer = setTimeout(finish, timeoutMs);
        // Unconditional: this is a Node CLI, where a timer always carries it.
        timer.unref();

        try {
            fs.mkdirSync(path.dirname(probePath), { recursive: true });
            fs.writeFileSync(probePath, '', 'utf8');
        } catch {
            finish();
        }
    });

    try {
        fs.rmSync(probePath, { force: true });
    } catch {
        // A probe left behind is inert: it is not a shard and nothing reads it.
    }
}

/**
 *
 * @param failure Runtime watcher failure signal.
 * @returns Error for fatal failure, or undefined after a shutdown signal.
 */
function waitForShutdown(failure: Promise<Error>): Promise<Error | undefined> {
    return new Promise(resolve => {
        const cleanup = (): void => {
            process.off('SIGINT', onSignal);
            process.off('SIGTERM', onSignal);
        };
        const onSignal = (): void => {
            cleanup();
            resolve(undefined);
        };
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
        failure.then(error => {
            cleanup();
            resolve(error);
        });
    });
}

/**
 * Explicitly watch the source files a newly-seen directory already contains.
 *
 * Only the directory's own entries, not its subtree: a nested directory
 * arrives as its own `addDir`, so recursing here would walk the same tree
 * twice and would also descend into places the ignore list prunes.
 *
 * Best effort by design. The directory can vanish between the event and the
 * read — a build tool writing a temporary tree, or a `mkdir` immediately
 * undone — and that is not a watcher failure. Reporting it would turn an
 * ordinary race into a fatal error, which is the opposite of the point.
 *
 * @param watcher Active chokidar watcher.
 * @param directory Absolute path chokidar reported as added.
 * @param isIgnored Predicate for paths the watch prunes.
 */
function watchSourcesAlreadyInside(
    watcher: FSWatcher,
    directory: string,
    isIgnored: (candidate: string) => boolean,
): void {
    if (isIgnored(directory)) {
        return;
    }
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (!entry.isFile() || !SOURCE_EXTENSION.test(entry.name)) {
            continue;
        }
        const candidate = path.join(directory, entry.name);
        if (isIgnored(candidate)) {
            continue;
        }
        watcher.add(candidate);
    }
}

/**
 *
 * @param root Resolved Next app root.
 * @param shardsDir Resolved safelist shard directory.
 * @param ignore Fast-glob ignore patterns.
 * @returns Chokidar path predicate for directories that can be pruned safely.
 */
function createIgnoredMatcher(
    root: string,
    shardsDir: string,
    ignore: readonly string[],
): (candidate: string) => boolean {
    const normalizedShardsDir = path.resolve(shardsDir);
    const matchers = ignore.flatMap(pattern => {
        const normalized = normalizeGlobPath(pattern);
        const variants = normalized.endsWith('/**')
            ? [normalized, normalized.slice(0, -3)]
            : [normalized];
        return variants.map(variant => new Minimatch(variant, { dot: true }));
    });

    return candidate => {
        const absolute = path.resolve(candidate);
        const relativeToShards = path.relative(absolute, normalizedShardsDir);
        if (
            absolute === normalizedShardsDir ||
            absolute.startsWith(`${normalizedShardsDir}${path.sep}`) ||
            (relativeToShards !== '..' &&
                !relativeToShards.startsWith(`..${path.sep}`) &&
                !path.isAbsolute(relativeToShards))
        ) {
            return false;
        }
        const relative = normalizeGlobPath(path.relative(root, absolute));
        if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
            return false;
        }
        return matchers.some(matcher => matcher.match(relative));
    };
}

/**
 * Normalize platform path separators for glob matching.
 *
 * @param value Path or glob pattern to normalize.
 * @returns Path using forward slashes.
 */
function normalizeGlobPath(value: string): string {
    return value.split(WINDOWS_PATH_SEPARATOR).join('/');
}

/**
 *
 * @param parserMode Requested source parser.
 * @returns Valid parser mode or undefined for the default.
 */
function normalizeParserMode(
    parserMode: NextWatchCommandOptions['parserMode'],
): 'rust' | 'wasm' | undefined {
    if (parserMode === undefined) {
        return undefined;
    }
    if (parserMode === 'rust' || parserMode === 'wasm') {
        return parserMode;
    }
    throw new Error(`Invalid --parser-mode "${parserMode}". Expected "rust" or "wasm".`);
}

/**
 * Normalize the CLI debounce option before it reaches timer APIs.
 *
 * @param debounceMs Numeric or CLI string value.
 * @returns Positive bounded debounce duration.
 */
function normalizeDebounceMs(debounceMs: number | string | undefined): number | undefined {
    if (debounceMs === undefined) {
        return undefined;
    }
    const parsed = typeof debounceMs === 'number' ? debounceMs : Number(debounceMs);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60_000) {
        throw new Error('Invalid --debounce-ms. Expected an integer between 0 and 60000.');
    }
    return parsed;
}
