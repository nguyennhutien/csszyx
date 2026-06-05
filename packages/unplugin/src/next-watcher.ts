/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import * as path from 'node:path';

import type { NextStateContext } from './next-state-context.js';
import type { NextWatcherCycleOptions, NextWatcherCycleResult } from './next-watcher-cycle.js';
import {
    NextWatcherLoop,
    type NextWatcherLoopCycleRunner,
    type NextWatcherLoopTimerHooks,
} from './next-watcher-loop.js';

/** Filesystem events that can change the materialized safelist. */
export type NextSafelistWatchEvent = 'add' | 'change' | 'unlink';

/** Options for the filesystem-independent Next safelist watcher controller. */
export interface NextSafelistWatcherOptions extends NextWatcherLoopTimerHooks {
    context: NextStateContext;
    cycleOptions?: NextWatcherCycleOptions;
    debounceMs?: number;
    runCycle?: NextWatcherLoopCycleRunner;
    onError?: (error: unknown) => void;
}

/**
 * Validate one watcher event path against the flat safelist shard directory.
 *
 * The future filesystem adapter must pass absolute paths. Restricting accepted
 * events to direct `.json` children prevents unrelated cache files, atomic
 * write temp files, and paths outside this app root from triggering a cycle.
 *
 * @param shardsDir Absolute safelist shard directory.
 * @param filePath Absolute event path.
 * @returns Whether the event belongs to a materialized shard.
 */
export function isNextSafelistShardPath(shardsDir: string, filePath: string): boolean {
    if (!path.isAbsolute(filePath)) {
        return false;
    }

    const relative = path.relative(path.resolve(shardsDir), path.resolve(filePath));
    return (
        relative.length > 0 &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative) &&
        !relative.includes(path.sep) &&
        !relative.startsWith('.') &&
        relative.endsWith('.json')
    );
}

/**
 * Validate that an absolute source event path belongs to the resolved app root.
 *
 * @param root Absolute Next app root.
 * @param filePath Absolute event path.
 * @returns Whether the source is inside the app root.
 */
export function isNextAppSourcePath(root: string, filePath: string): boolean {
    if (!path.isAbsolute(filePath)) {
        return false;
    }

    const relative = path.relative(path.resolve(root), path.resolve(filePath));
    return (
        relative.length > 0 &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

/**
 * Lifecycle controller between an OS file watcher and the materialization loop.
 *
 * This class deliberately does not import `chokidar` or `fs.watch`. A CLI can
 * own that dependency and feed normalized events here while the state machine
 * remains deterministic and package-size neutral.
 */
export class NextSafelistWatcher {
    private readonly root: string;
    private readonly shardsDir: string;
    private readonly loop: NextWatcherLoop;
    private started = false;
    private closed = false;

    /**
     *
     * @param options
     */
    constructor(options: NextSafelistWatcherOptions) {
        this.root = path.resolve(options.context.root);
        this.shardsDir = path.resolve(options.context.safelist.shardsDir);
        this.loop = new NextWatcherLoop(options);
    }

    /**
     *
     */
    get pending(): boolean {
        return this.loop.pending;
    }

    /**
     *
     */
    get lastResult(): NextWatcherCycleResult | undefined {
        return this.loop.lastResult;
    }

    /**
     *
     */
    get lastError(): unknown {
        return this.loop.lastError;
    }

    /**
     * Materialize existing shards before accepting live filesystem events.
     */
    start(): NextWatcherCycleResult {
        if (this.closed) {
            throw new Error('[csszyx] Cannot start a closed Next safelist watcher.');
        }
        if (this.started && this.loop.lastResult) {
            return this.loop.lastResult;
        }

        this.started = true;
        this.loop.notify('initial');
        const result = this.loop.flush();
        if (!result) {
            throw new Error('[csszyx] Next safelist watcher failed to run its initial cycle.');
        }
        return result;
    }

    /**
     * Queue a materialization cycle for one relevant shard filesystem event.
     *
     * @param event Normalized add/change/unlink event.
     * @param filePath Absolute event path.
     * @returns Whether the event was accepted.
     */
    notify(event: NextSafelistWatchEvent, filePath: string): boolean {
        if (this.closed || !this.started || !isNextSafelistShardPath(this.shardsDir, filePath)) {
            return false;
        }

        this.loop.notify(`shard:${event}`);
        return true;
    }

    /**
     * Queue tombstone cleanup after a source file is removed.
     *
     * @param filePath Absolute deleted source path.
     * @returns Whether the event was accepted.
     */
    notifySourceRemoval(filePath: string): boolean {
        if (this.closed || !this.started || !isNextAppSourcePath(this.root, filePath)) {
            return false;
        }

        this.loop.notify('source:unlink');
        return true;
    }

    /**
     * Flush any pending event batch immediately.
     */
    flush(): NextWatcherCycleResult | undefined {
        return this.loop.flush();
    }

    /**
     * Flush pending work before permanently closing the controller.
     */
    close(): NextWatcherCycleResult | undefined {
        if (this.closed) {
            return undefined;
        }

        this.closed = true;
        try {
            return this.loop.flush();
        } finally {
            this.loop.dispose();
        }
    }
}
