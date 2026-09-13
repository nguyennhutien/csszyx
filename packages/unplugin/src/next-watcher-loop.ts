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
 * The shortest wait between two attempts on a lock the Turbopack loader holds.
 *
 * A retry otherwise reuses the debounce, and `--debounce-ms 0` turned it into
 * a loop about 1.4 ms apart that spent a quarter of a core while the lock stayed
 * held.
 */
export const LOADER_LOCK_RETRY_MIN_MS = 50;

/**
 * How long the loader may hold the lock before the watcher says so, once.
 *
 * The loader's cycle takes about a millisecond, so an ordinary overlap clears on
 * the first retry and never comes near this. A loader killed inside that cycle
 * leaves its lock until it goes stale 30 s later, and classes added in between
 * get no CSS; without this notice nothing says why.
 */
export const LOADER_LOCK_WARN_AFTER_MS = 1_000;

/**
 * How long the watcher waits on the loader before it reports the lock.
 *
 * Twice the 30 s window after which a lock left by a dead holder is recovered.
 * A live loader never holds it this long, because its cycle runs synchronously,
 * so past this point waiting explains nothing and the failure is reported.
 */
export const LOADER_LOCK_GIVE_UP_AFTER_MS = 60_000;

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
function isHeldByTurbopackLoader(error: unknown): error is NextSafelistStateLockedError {
    return (
        error instanceof NextSafelistStateLockedError &&
        error.holder.command === NEXT_TURBO_LOADER_LOCK_COMMAND
    );
}

/** Timer hooks kept injectable so debounce behavior is deterministic in tests. */
export interface NextWatcherLoopTimerHooks {
    setTimeout?: (callback: () => void, delayMs: number) => WatcherTimer;
    clearTimeout?: (timer: WatcherTimer) => void;
    /** Clock that times a wait on the loader's lock; `Date.now` by default. */
    now?: () => number;
}

/** Options for the long-running Next watcher loop core. */
export interface NextWatcherLoopOptions extends NextWatcherLoopTimerHooks {
    context: NextStateContext;
    cycleOptions?: NextWatcherCycleOptions;
    debounceMs?: number;
    runCycle?: NextWatcherLoopCycleRunner;
    onError?: (error: unknown) => void;
    /** Receives a notice the watcher keeps running through; dropped by default. */
    onWarn?: (message: string) => void;
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
    private readonly nowFn: () => number;
    private readonly onError?: (error: unknown) => void;
    private readonly onWarn?: (message: string) => void;
    private timer: WatcherTimer | undefined;
    private disposed = false;
    private readonly pendingReasons = new Set<string>();
    /** When the current wait on the loader's lock began; unset while not waiting. */
    private loaderWaitStartedAt: number | undefined;
    private loaderWaitWarned = false;

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
        this.nowFn = options.now ?? Date.now;
        this.onError = options.onError;
        this.onWarn = options.onWarn;
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
        this.schedule(this.debounceMs);
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
     * Run the pending cycle now, or queue it when the Turbopack loader holds the
     * lock.
     *
     * `flush` throws on every failure, which is what closing needs. Starting
     * needs this instead: `next watch` and `next dev` start together, so the
     * loader's first compile can hold the lock exactly when the initial cycle
     * runs, and that overlap is not a failure.
     *
     * @returns The cycle result, or `undefined` when nothing was pending or the
     *   cycle is queued behind the loader.
     */
    flushOrQueue(): NextWatcherCycleResult | undefined {
        if (this.disposed || this.timer === undefined) {
            return undefined;
        }

        const reasons = [...this.pendingReasons];
        try {
            return this.runPendingCycle();
        } catch (error) {
            if (this.waitForLoader(error, reasons)) {
                return undefined;
            }
            throw error;
        }
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
     * Run the pending cycle after `delayMs`, unless a run is already scheduled.
     *
     * @param delayMs - How long to wait before running it.
     */
    private schedule(delayMs: number): void {
        if (this.timer !== undefined) {
            return;
        }

        this.timer = this.setTimeoutFn(() => {
            const reasons = [...this.pendingReasons];
            try {
                this.runPendingCycle();
            } catch (error) {
                if (this.waitForLoader(error, reasons)) {
                    return;
                }
                this.lastError = error;
                this.onError?.(error);
            }
        }, delayMs);
    }

    /**
     * Queue a cycle again when it failed only because the Turbopack loader holds
     * the lock.
     *
     * Retried, not dropped: the loader's pass read the shards as they stood when
     * it began, and the event that woke this cycle may be newer. The wait is
     * timed from the first refusal, says so once when it runs long, and ends in
     * a reported failure when it runs longer than any live loader could explain.
     *
     * @param error - What the cycle threw.
     * @param reasons - The reasons the failed cycle carried, queued again with it.
     * @returns True when nothing should be reported: the cycle is queued, or the
     *   loop was disposed meanwhile.
     */
    private waitForLoader(error: unknown, reasons: readonly string[]): boolean {
        if (!isHeldByTurbopackLoader(error)) {
            return false;
        }

        const now = this.nowFn();
        this.loaderWaitStartedAt ??= now;
        const waited = now - this.loaderWaitStartedAt;
        if (waited > LOADER_LOCK_GIVE_UP_AFTER_MS) {
            this.endLoaderWait();
            return false;
        }
        if (waited >= LOADER_LOCK_WARN_AFTER_MS && !this.loaderWaitWarned) {
            this.loaderWaitWarned = true;
            const warn = this.onWarn ?? (() => {});
            warn(
                `[csszyx] next watch is waiting for the safelist lock held by the Turbopack loader (process ${error.holder.pid}). ` +
                    'Classes added meanwhile get no CSS until it is released; a lock left by a loader that exited is recovered within 30 s.',
            );
        }
        if (this.disposed) {
            return true;
        }

        for (const reason of reasons) {
            this.pendingReasons.add(reason);
        }
        this.schedule(Math.max(this.debounceMs, LOADER_LOCK_RETRY_MIN_MS));
        return true;
    }

    /** Forget the current wait on the loader, once a cycle gets through or gives up. */
    private endLoaderWait(): void {
        this.loaderWaitStartedAt = undefined;
        this.loaderWaitWarned = false;
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
        this.endLoaderWait();
        return result;
    }
}
