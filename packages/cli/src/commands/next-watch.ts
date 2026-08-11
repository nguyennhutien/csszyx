/**
 * csszyx next-watch - Maintain the Next.js Turbopack Tailwind safelist.
 *
 * Startup runs the existing prebuild contract once. Chokidar then observes
 * metadata shards plus source removals; source add/change transforms remain
 * owned by the Turbopack loader so the CLI does not duplicate compiler work.
 */

import * as path from 'node:path';

import { runNextPrebuild } from '@csszyx/unplugin/next-prebuild';
import { type NextSafelistWatchEvent, NextSafelistWatcher } from '@csszyx/unplugin/next-watcher';
import { type ChokidarOptions, type FSWatcher, watch } from 'chokidar';
import fg from 'fast-glob';
import { Minimatch } from 'minimatch';

import { colors, icons } from '../utils/terminal-ui.js';
import { DEFAULT_NEXT_SOURCE_IGNORE, DEFAULT_NEXT_SOURCE_PATTERN } from './next-patterns.js';

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/i;
const WINDOWS_PATH_SEPARATOR = String.fromCodePoint(92);

/** Options accepted by the `next-watch` CLI command. */
export interface NextWatchCommandOptions {
    cwd?: string;
    root?: string;
    parserMode?: 'rust' | 'oxc' | 'babel';
    outputFile?: string;
    cacheDir?: string;
    pattern?: string;
    extraIgnore?: readonly string[];
    importedStaticSz?: boolean;
    debounceMs?: number | string;
    silent?: boolean;
}

/** Minimal watcher factory kept injectable for lifecycle tests. */
export type NextWatchFactory = (
    paths: string | readonly string[],
    options: ChokidarOptions,
) => FSWatcher;

/** Dependencies that can be replaced by tests. */
export interface NextWatchDependencies {
    watch?: NextWatchFactory;
}

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
    const root = path.resolve(options.root ?? cwd);
    const pattern = options.pattern ?? DEFAULT_NEXT_SOURCE_PATTERN;
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
    const watchFactory = dependencies.watch ?? watch;
    const fsWatcher = watchFactory(root, {
        ignoreInitial: true,
        persistent: true,
        atomic: true,
        awaitWriteFinish: {
            stabilityThreshold: 25,
            pollInterval: 10,
        },
        ignored: createIgnoredMatcher(root, prebuild.context.safelist.shardsDir, ignore),
    });

    fsWatcher.on('all', (event, filePath) => {
        const absolutePath = path.resolve(filePath);
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
): 'rust' | 'oxc' | 'babel' | undefined {
    if (parserMode === undefined) {
        return undefined;
    }
    if (parserMode === 'rust' || parserMode === 'oxc' || parserMode === 'babel') {
        return parserMode;
    }
    throw new Error(`Invalid --parser-mode "${parserMode}". Expected "rust", "oxc", or "babel".`);
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
