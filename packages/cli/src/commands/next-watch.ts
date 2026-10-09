/**
 * csszyx next-watch - Maintain the Next.js Turbopack Tailwind safelist.
 *
 * Startup runs the existing prebuild contract once. A file watcher then
 * observes metadata shards plus source removals; source add/change transforms
 * remain owned by the Turbopack loader so the CLI does not duplicate compiler
 * work. macOS and Windows watch through Node's recursive `fs.watch`, other
 * platforms through chokidar; see {@link nextWatchFactoryFor}.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    createRootIgnoreMatcher,
    prepareNextStylesheetFacts,
    runNextPrebuild,
} from '@csszyx/unplugin/next-prebuild';
import {
    NEXT_WATCH_LOCK_COMMAND,
    type NextSafelistMaterializeResult,
    type NextSafelistWatchEvent,
    NextSafelistWatcher,
} from '@csszyx/unplugin/next-watcher';
import { type ChokidarOptions, watch } from 'chokidar';
import fg from 'fast-glob';
import { withPosixSeparators } from '../utils/posix-path.js';
import { colors, icons } from '../utils/terminal-ui.js';
import { type NextFileWatcher, watchRecursively } from './native-recursive-watcher.js';
import { writeNextDiagnosticPolicy } from './next-diagnostic-policy.js';
import { tryWriteMergeRegistration } from './next-merge-registration.js';
import { DEFAULT_NEXT_SOURCE_IGNORE, DEFAULT_NEXT_SOURCE_PATTERN } from './next-patterns.js';

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/i;

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
    /** The stylesheets the app loads, when the project also holds others. */
    tailwindStylesheet?: readonly string[];
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
 * nothing in any log. Registering the canonical name is what removes the
 * mismatch, and it is what Vite does for the same reason.
 *
 * Node 24.21.0 and 26.8.0 carry the upstream fix, which falls back to the
 * name the event reported instead of aborting. They report `1.52.1` like the
 * releases that abort, because the patch was taken without a libuv version
 * bump, so the bundled version tells you nothing about it. Every other
 * release this package supports still aborts: Node 22, 25, and 24.16 through
 * 24.20.
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
    return (WATCH_ROOT_RESOLVERS[process.platform] ?? identity)(root);
}

/**
 * Keep a root as given; every platform but Windows.
 *
 * @param root Absolute watch root.
 * @returns The same root.
 */
const identity = (root: string): string => root;

/* v8 ignore start -- Windows-only: coverage is measured on Linux, where this
   resolver is never selected. Both arms are pinned on the Windows CI lane by
   the canonicalWatchRoot unit test, which resolves the runner's 8.3 temp path
   and asks for a root that does not exist. */
/**
 * Resolve to the final name; a root that refuses the query is kept as given.
 *
 * @param root Absolute watch root.
 * @returns The canonical root, or the given one when it cannot be resolved.
 */
const realpathNative = (root: string): string => {
    try {
        return fs.realpathSync.native(root);
    } catch {
        return root;
    }
};
/* v8 ignore stop */

/** A lookup rather than a branch, so the platform choice is not a half-taken
 * `if` on every machine that measures coverage. */
const WATCH_ROOT_RESOLVERS: Partial<Record<NodeJS.Platform, (root: string) => string>> = {
    win32: realpathNative,
};

/** Minimal watcher factory kept injectable for lifecycle tests. */
export type NextWatchFactory = (
    paths: string | readonly string[],
    options: ChokidarOptions,
) => NextFileWatcher;

/**
 * Chokidar: one watch per directory and per file.
 *
 * @param paths - What to watch.
 * @param options - Chokidar's options, as `next watch` sets them.
 * @returns The watcher.
 */
export const chokidarNextWatchFactory: NextWatchFactory = (paths, options) =>
    watch(typeof paths === 'string' ? paths : [...paths], options);

/**
 * Node's recursive `fs.watch`: one operating-system stream for the whole tree.
 *
 * Only the ignore predicate carries over; the rest of chokidar's options have
 * no counterpart and no need of one. `awaitWriteFinish` guarded against
 * reading a half-written file, and every shard is written to a temporary name
 * and renamed into place.
 *
 * @param paths - The watch root.
 * @param options - The options chokidar would get; only `ignored` is read.
 * @returns The watcher.
 */
export const nativeNextWatchFactory: NextWatchFactory = (paths, options) =>
    watchRecursively(String(paths), {
        ignored: filePath => (options.ignored as (candidate: string) => boolean)(filePath),
    });

/**
 * The platforms the native stream serves. Measured with a file written into a
 * directory created while the watch runs, then deleted, across macOS, Windows
 * and Linux on Node 22 and 24: under CPU load chokidar lost that file's events
 * on macOS only, the native stream nowhere. Linux keeps chokidar because the
 * native watch there is Node's own per-file walk, and without the `ignore`
 * option (Node 24.14 and 25.5 onwards) it watches all of `node_modules`:
 * 237,428 inotify watches and about 1 GB on this repository.
 */
const WATCH_FACTORIES: Partial<Record<NodeJS.Platform, NextWatchFactory>> = {
    darwin: nativeNextWatchFactory,
    win32: nativeNextWatchFactory,
};

/**
 * The file watcher `next watch` uses on a platform.
 *
 * @param platform - The platform to answer for; the running one by default.
 * @returns The watcher factory for it.
 */
export function nextWatchFactoryFor(
    platform: NodeJS.Platform = process.platform,
): NextWatchFactory {
    return WATCH_FACTORIES[platform] ?? chokidarNextWatchFactory;
}

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
    /**
     * How often the sources the safelist holds are checked on the disk.
     * Present so tests can see a lost deletion reaped without waiting for
     * the real interval.
     */
    sourceSweepMs?: number;
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

/**
 * How often the sources the safelist holds are checked on the disk.
 *
 * A watcher can lose the events of a file written into a directory it has
 * just started watching: chokidar did on macOS under load, and on Linux CI a
 * session saw the directory and never its file, so the file's deletion
 * arrived nowhere and its classes stayed in the safelist for good. Only a
 * source that has gone prompts a cycle; the check itself writes nothing, so
 * Tailwind is not made to rebuild by it.
 */
const SOURCE_SWEEP_MS = 2000;

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

    let model: Awaited<ReturnType<typeof prepareNextStylesheetFacts>>['model'] | null = null;
    const recordStylesheetFacts = async (): Promise<void> => {
        const facts = await prepareNextStylesheetFacts({
            explicitRoot: root,
            cwd,
            cacheDir: options.cacheDir,
            tailwindStylesheet: options.tailwindStylesheet,
            files,
            // Only the user's patterns: the built-in ones cover `node_modules`,
            // where a package stylesheet that a source file imports lives.
            ignore: options.extraIgnore ?? [],
            setting: 'the `--tailwind-stylesheet` flag',
            ignoreSetting: 'the `--ignore` flag',
        });
        model = facts.model;
        if (facts.warning !== null) printWatcherNotice(facts.warning);
    };
    // The loader lowers with the prefix these record, so they are read before
    // the first cycle, the way a bundler build reads them.
    await recordStylesheetFacts();
    // Read once, at start: the loader reads the policy this writes. An edit to
    // the config takes effect at the next start.
    for (const warning of await writeNextDiagnosticPolicy(root)) printWatcherNotice(warning);

    const prebuild = runNextPrebuild({
        files,
        explicitRoot: root,
        cwd,
        mode: 'development',
        parserMode,
        safelistOutputFile: options.outputFile,
        cacheDir: options.cacheDir,
        importedStaticSz: options.importedStaticSz,
        tailwindStylesheet: options.tailwindStylesheet && [...options.tailwindStylesheet],
        config: { mangleVars: false },
        // The Turbopack loader steps aside only for a watcher. This pass is the
        // watcher's own startup, and the initial cycle below reads every shard
        // the loader writes while it runs, so it records the watcher's command.
        lockCommand: NEXT_WATCH_LOCK_COMMAND,
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

    // The merge table and the unserved list the loader imports: rewritten
    // after every cycle, since the shards carry the census, and after every
    // stylesheet edit, since the design system signs the table.
    let census: NextSafelistMaterializeResult = prebuild.cycle.materialize;
    const writeRegistration = (): void => {
        const warning = tryWriteMergeRegistration({
            root,
            model,
            classes: census.classes,
            authoredClasses: census.authoredClasses,
            mergeLiterals: census.mergeLiterals,
            sources: files,
        });
        if (warning !== null) printWatcherNotice(warning);
    };
    writeRegistration();

    const controller = new NextSafelistWatcher({
        context: prebuild.context,
        debounceMs,
        onError: reportFailure,
        onWarn: printWatcherNotice,
        onCycle: result => {
            census = result.materialize;
            writeRegistration();
        },
    });
    const isIgnored = createIgnoredMatcher(root, prebuild.context.safelist.shardsDir, ignore);
    const watchFactory = dependencies.watch ?? nextWatchFactoryFor();
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

    let factsWrites: Promise<void> = Promise.resolve();
    // A stylesheet edit can change the prefix. Rewriting the facts file re-runs
    // the loader for every module that depends on it. An edit that leaves the
    // stylesheets unreadable is reported, and the session goes on: the author
    // is mid-edit.
    const refreshStylesheetFacts = (): void => {
        factsWrites = factsWrites
            .then(recordStylesheetFacts)
            .then(writeRegistration)
            .catch((error: unknown) => {
                // The build's note says nothing was written, which a watch
                // that goes on is not; say what it goes on with instead.
                const message = (error as Error).message.replace(/\n {2}note: .*$/, '');
                printWatcherNotice(
                    `${message}\n  note: \`csszyx next watch\` keeps watching; the loader stops on this error until the stylesheets agree again.`,
                );
            });
    };
    fsWatcher.on('all', (event, filePath) => {
        // The platform saw a change and could not say where, so anything may
        // have changed: the stylesheets are read again and every shard is
        // reconciled against the disk.
        if (event === 'rescan') {
            refreshStylesheetFacts();
            controller.rescan();
            return;
        }
        const absolutePath = path.resolve(filePath);
        if (absolutePath === probePath) {
            return;
        }
        if (absolutePath.endsWith('.css')) {
            refreshStylesheetFacts();
            return;
        }
        // A directory removed or moved in one step can arrive as a single
        // event for the directory and none for the sources in it. Every cycle
        // checks each shard's source on disk, so prompting one is enough to
        // reap them.
        if (event === 'unlinkDir') {
            controller.notifySourceRemoval(absolutePath);
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

    const sweep = setInterval(() => {
        if (!controller.pending && census.sourcePaths.some(source => !fs.existsSync(source))) {
            controller.rescan();
        }
    }, dependencies.sourceSweepMs ?? SOURCE_SWEEP_MS);
    sweep.unref();

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
            clearInterval(sweep);
            await factsWrites;
            await fsWatcher.close();
            controller.close();
        },
    };
}

/**
 * Print a notice the watcher keeps running through.
 *
 * @param message - The notice, already prefixed with `[csszyx]`.
 */
export function printWatcherNotice(message: string): void {
    console.warn(`${colors.warn(icons.warn)} ${message}`);
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
function waitForWatcherReady(watcher: NextFileWatcher): Promise<void> {
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
    watcher: NextFileWatcher,
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
        // `failure` only ever resolves, with the error that stopped the watch.
        void failure.then(error => {
            cleanup();
            resolve(error);
        });
    });
}

/** What chokidar knows about a path it asks about, when it knows anything. */
type KnownEntry = Pick<fs.Stats, 'isFile'>;

/**
 * Build chokidar's `ignored` predicate from the ignore list.
 *
 * chokidar asks about a path before it has stat'ed it and again once it has.
 * Without stats the path may be a directory, and `legacy/*` matches the
 * directory `legacy/deep` while the source glob still reads what is inside, so
 * only a path whose whole tree is left out is pruned then. A file is left out
 * on the second question, when chokidar says it is one.
 *
 * @param root Resolved Next app root.
 * @param shardsDir Resolved safelist shard directory.
 * @param ignore Fast-glob ignore patterns.
 * @returns Chokidar path predicate.
 */
function createIgnoredMatcher(
    root: string,
    shardsDir: string,
    ignore: readonly string[],
): (candidate: string, entry?: KnownEntry) => boolean {
    const normalizedShardsDir = path.resolve(shardsDir);
    const matcher = createRootIgnoreMatcher(root, ignore);

    return (candidate, entry) => {
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
        return (
            matcher.coversTree(absolute) ||
            (entry?.isFile() === true && matcher.ignoresFile(absolute))
        );
    };
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
