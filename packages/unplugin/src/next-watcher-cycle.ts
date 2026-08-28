import * as path from 'node:path';

import {
    readNextGenerationManifest,
    validateNextGenerationManifest,
    writeNextGenerationManifest,
} from './next-generation-manifest.js';
import {
    type AtomicWriteOptions,
    acquireNextSafelistStateLock,
    materializeNextSafelist,
    NEXT_WATCH_LOCK_COMMAND,
    type NextSafelistMaterializeResult,
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
            throw new Error(
                `[csszyx] Next watcher wrote an invalid generation manifest: ${validation.reason}`,
            );
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
