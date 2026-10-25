import * as path from 'node:path';
import { diagnosticError } from './diagnostic-message.js';
import {
    readNextGenerationManifest,
    validateNextGenerationManifest,
    writeNextGenerationManifest,
} from './next-generation-manifest.js';
import {
    type AtomicWriteOptions,
    acquireNextSafelistStateLock,
    materializeNextSafelist,
    NEXT_TURBO_LOADER_LOCK_COMMAND,
    NEXT_WATCH_LOCK_COMMAND,
    type NextSafelistMaterializeResult,
    NextSafelistStateLockedError,
    type NextSafelistStateLockOptions,
} from './next-safelist-state.js';
import {
    createNextGenerationManifestFromContext,
    type NextStateContext,
} from './next-state-context.js';

/** Options for one synchronous watcher materialization cycle. */
export interface NextWatcherCycleOptions {
    lockOptions?: NextSafelistStateLockOptions;
    writeOptions?: AtomicWriteOptions;
    createdAt?: string;
}

/** Result returned by one watcher materialization cycle. */
export interface NextWatcherCycleResult {
    materialize: NextSafelistMaterializeResult;
    manifestPath: string;
    lockPath: string;
}

/**
 * Run one locked watcher materialization cycle.
 *
 * This is the synchronous core that a future long-running Node watcher can call
 * after FS events. It deliberately avoids owning `fs.watch` lifecycle here so
 * state transitions remain small and directly testable.
 *
 * @param context Shared Next state context.
 * @param options Lock/write/time options.
 * @returns Materialization result and touched state paths.
 */
export function runNextWatcherCycle(
    context: NextStateContext,
    options: NextWatcherCycleOptions = {},
): NextWatcherCycleResult {
    const lockPath = path.join(context.cacheDir, 'state.lock');
    const lock = acquireNextSafelistStateLock(lockPath, {
        root: context.root,
        mode: context.manifestExpectation.mode,
        command: NEXT_WATCH_LOCK_COMMAND,
        ...options.lockOptions,
    });

    try {
        const materialize = materializeNextSafelist(context.safelist, options.writeOptions);
        writeNextGenerationManifest(
            context.manifestPath,
            createNextGenerationManifestFromContext(
                context,
                materialize.sourceCount,
                options.createdAt,
            ),
            options.writeOptions,
        );

        const validation = validateNextGenerationManifest(
            readNextGenerationManifest(context.manifestPath),
            context.manifestExpectation,
        );
        if (!validation.ok) {
            throw diagnosticError('internal-error', {
                where: 'runNextWatcherCycle',
                detail: `the manifest the watcher wrote reads back invalid (${validation.reason})`,
            });
        }

        lock.heartbeat();
        return {
            materialize,
            manifestPath: context.manifestPath,
            lockPath,
        };
    } finally {
        lock.release();
    }
}

/**
 * Whether a cycle failed only because the Turbopack loader was mid-cycle.
 *
 * The documented Next setup runs `csszyx next watch` beside `next dev`, and the
 * loader takes the same lock for a cycle of its own after writing a shard. The
 * loader already steps aside for a watcher; this is the same overlap seen from
 * the watcher's side. Reported as a failure, it ended the watch process, and
 * `concurrently --kill-others-on-fail` then stopped `next dev` with it.
 *
 * @param error - What the cycle threw.
 * @returns True when the lock is held by the loader and nothing else went wrong.
 */
export function isHeldByTurbopackLoader(error: unknown): error is NextSafelistStateLockedError {
    return (
        error instanceof NextSafelistStateLockedError &&
        error.holder.command === NEXT_TURBO_LOADER_LOCK_COMMAND
    );
}

/**
 * Run one watcher cycle, or step aside when the Turbopack loader holds the lock.
 *
 * `next watch` materializes once at startup, before its watcher starts. The
 * loader can hold the lock at that moment, and then it is the loader's turn:
 * the watcher's initial cycle, queued behind the lock, reads every shard once
 * the loader lets go. Any other failure is thrown.
 *
 * @param context Shared Next state context.
 * @param options Lock/write/time options.
 * @returns The cycle's result, or null when the loader holds the lock.
 */
export function runNextWatcherCycleUnlessLoaderHolds(
    context: NextStateContext,
    options: NextWatcherCycleOptions = {},
): NextWatcherCycleResult | null {
    try {
        return runNextWatcherCycle(context, options);
    } catch (error) {
        if (isHeldByTurbopackLoader(error)) return null;
        throw error;
    }
}
