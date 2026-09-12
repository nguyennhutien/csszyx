/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import {
    NEXT_TURBO_LOADER_LOCK_COMMAND,
    NextSafelistStateLockedError,
} from './next-safelist-state.js';
import type { NextStateContext } from './next-state-context.js';
import {
    type NextWatcherCycleOptions,
    type NextWatcherCycleResult,
    runNextWatcherCycle,
} from './next-watcher-cycle.js';

/**
 *
 */
type WatcherTimer = ReturnType<typeof setTimeout>;

/** Function used to run one materialization cycle. */
export type NextWatcherLoopCycleRunner = (
    context: NextStateContext,
    options: NextWatcherCycleOptions,
    reasons: readonly string[],
) => NextWatcherCycleResult;

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
function isHeldByTurbopackLoader(error: unknown): boolean {
    return (
        error instanceof NextSafelistStateLockedError &&
        error.holder.command === NEXT_TURBO_LOADER_LOCK_COMMAND
    );
}

/** Timer hooks kept injectable so debounce behavior is deterministic in tests. */
export interface NextWatcherLoopTimerHooks {
    setTimeout?: (callback: () => void, delayMs: number) => WatcherTimer;
    clearTimeout?: (timer: WatcherTimer) => void;
}

/** Options for the long-running Next watcher loop core. */
export interface NextWatcherLoopOptions extends NextWatcherLoopTimerHooks {
    context: NextStateContext;
    cycleOptions?: NextWatcherCycleOptions;
    debounceMs?: number;
    runCycle?: NextWatcherLoopCycleRunner;
    onError?: (error: unknown) => void;
}

/**
 * Small debounce loop around the synchronous watcher cycle.
 *
 * This class intentionally does not own `fs.watch`/`chokidar`; callers feed it
 * events via `notify()`. Keeping the loop independent from OS watchers makes
 * coalescing, flushing, and error behavior directly testable.
 */
export class NextWatcherLoop {
    private readonly context: NextStateContext;
    private readonly cycleOptions: NextWatcherCycleOptions;
    private readonly debounceMs: number;
    private readonly runCycle: NextWatcherLoopCycleRunner;
    private readonly setTimeoutFn: (callback: () => void, delayMs: number) => WatcherTimer;
    private readonly clearTimeoutFn: (timer: WatcherTimer) => void;
    private readonly onError?: (error: unknown) => void;
    private timer: WatcherTimer | undefined;
    private disposed = false;
    private readonly pendingReasons = new Set<string>();

    lastResult: NextWatcherCycleResult | undefined;
    lastError: unknown;

    /**
     *
     * @param options
     */
    constructor(options: NextWatcherLoopOptions) {
        this.context = options.context;
        this.cycleOptions = options.cycleOptions ?? {};
        this.debounceMs = options.debounceMs ?? 50;
        this.runCycle = options.runCycle ?? runNextWatcherCycle;
        this.setTimeoutFn = options.setTimeout ?? setTimeout;
        this.clearTimeoutFn = options.clearTimeout ?? clearTimeout;
        this.onError = options.onError;
    }

    /**
     *
     */
    get pending(): boolean {
        return this.timer !== undefined;
    }

    /**
     *
     */
    get reasons(): readonly string[] {
        return [...this.pendingReasons];
    }

    /**
     *
     * @param reason
     */
    notify(reason = 'change'): void {
        if (this.disposed) {
            return;
        }

        this.pendingReasons.add(reason);
        if (this.timer !== undefined) {
            return;
        }

        this.timer = this.setTimeoutFn(() => {
            const reasons = [...this.pendingReasons];
            try {
                this.runPendingCycle();
            } catch (error) {
                if (isHeldByTurbopackLoader(error)) {
                    // Retried, not dropped: the loader's pass read the shards as
                    // they stood when it began, and the event that woke this
                    // cycle may be newer. A disposed loop ignores the notify.
                    for (const reason of reasons) {
                        this.notify(reason);
                    }
                    return;
                }
                this.lastError = error;
                this.onError?.(error);
            }
        }, this.debounceMs);
    }

    /**
     *
     */
    flush(): NextWatcherCycleResult | undefined {
        if (this.disposed || this.timer === undefined) {
            return undefined;
        }

        return this.runPendingCycle();
    }

    /**
     *
     */
    dispose(): void {
        if (this.timer !== undefined) {
            this.clearTimeoutFn(this.timer);
        }
        this.timer = undefined;
        this.pendingReasons.clear();
        this.disposed = true;
    }

    /**
     *
     */
    private runPendingCycle(): NextWatcherCycleResult {
        const timer = this.timer;
        if (timer !== undefined) {
            this.clearTimeoutFn(timer);
        }
        this.timer = undefined;

        const reasons = [...this.pendingReasons];
        this.pendingReasons.clear();
        const result = this.runCycle(this.context, this.cycleOptions, reasons);
        this.lastResult = result;
        this.lastError = undefined;
        return result;
    }
}
