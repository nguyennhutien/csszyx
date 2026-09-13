import { describe, expect, it } from 'vitest';

import { NextSafelistStateLockedError } from '../src/next-safelist-state.js';
import { createNextStateContext } from '../src/next-state-context.js';
import {
    LOADER_LOCK_GIVE_UP_AFTER_MS,
    LOADER_LOCK_RETRY_MIN_MS,
    LOADER_LOCK_WARN_AFTER_MS,
    NextWatcherLoop,
    type NextWatcherLoopCycleRunner,
} from '../src/next-watcher-loop.js';

describe('Next watcher loop', () => {
    function context() {
        return createNextStateContext({
            explicitRoot: '/repo/apps/web',
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
        });
    }

    function scheduler() {
        let nextId = 1;
        const pending = new Map<number, { callback: () => void; delayMs: number }>();

        return {
            pending,
            setTimeout(callback: () => void, delayMs: number) {
                const id = nextId++;
                pending.set(id, { callback, delayMs });
                return id as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimeout(timer: ReturnType<typeof setTimeout>) {
                pending.delete(timer as unknown as number);
            },
            runAll() {
                const tasks = [...pending.entries()];
                pending.clear();
                for (const [, task] of tasks) {
                    task.callback();
                }
            },
        };
    }

    it('coalesces burst notifications into one debounced cycle', () => {
        const timers = scheduler();
        const calls: readonly string[][] = [];
        const runCycle: NextWatcherLoopCycleRunner = (_context, _options, reasons) => {
            (calls as string[][]).push([...reasons]);
            return {
                materialize: {
                    classCount: 2,
                    sourceCount: 1,
                    tombstonedSourceCount: 0,
                    shardCount: 1,
                },
                manifestPath: '/repo/apps/web/.csszyx/cache/generation-manifest.json',
                lockPath: '/repo/apps/web/.csszyx/cache/state.lock',
            };
        };

        const loop = new NextWatcherLoop({
            context: context(),
            debounceMs: 75,
            runCycle,
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });

        loop.notify('source-change');
        loop.notify('pending-shard');

        expect(loop.pending).toBe(true);
        expect(loop.reasons).toEqual(['source-change', 'pending-shard']);
        expect([...timers.pending.values()].map(task => task.delayMs)).toEqual([75]);

        timers.runAll();

        expect(calls).toEqual([['source-change', 'pending-shard']]);
        expect(loop.pending).toBe(false);
        expect(loop.lastResult?.materialize.classCount).toBe(2);
    });

    it('flushes the pending cycle immediately and clears the timer', () => {
        const timers = scheduler();
        let callCount = 0;
        const loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                callCount += 1;
                return {
                    materialize: {
                        classCount: 1,
                        sourceCount: 1,
                        tombstonedSourceCount: 0,
                        shardCount: 1,
                    },
                    manifestPath: '/manifest.json',
                    lockPath: '/state.lock',
                };
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });

        loop.notify('manual');

        expect(loop.flush()?.materialize.classCount).toBe(1);
        expect(callCount).toBe(1);
        expect(loop.pending).toBe(false);
        expect(timers.pending.size).toBe(0);

        timers.runAll();
        expect(callCount).toBe(1);
    });

    it('captures scheduled cycle errors without throwing from the timer callback', () => {
        const timers = scheduler();
        const errors: unknown[] = [];
        const error = new Error('materialize failed');
        const loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                throw error;
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
            onError: caught => {
                errors.push(caught);
            },
        });

        loop.notify('pending-shard');
        timers.runAll();

        expect(loop.pending).toBe(false);
        expect(loop.lastError).toBe(error);
        expect(errors).toEqual([error]);
    });

    it('throws flush errors to callers and allows a later successful cycle', () => {
        const timers = scheduler();
        const error = new Error('flush failed');
        let shouldThrow = true;
        const loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                if (shouldThrow) {
                    throw error;
                }
                return {
                    materialize: {
                        classCount: 1,
                        sourceCount: 1,
                        tombstonedSourceCount: 0,
                        shardCount: 1,
                    },
                    manifestPath: '/manifest.json',
                    lockPath: '/state.lock',
                };
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });

        loop.notify('source-change');
        expect(() => loop.flush()).toThrow(error);
        expect(loop.pending).toBe(false);

        shouldThrow = false;
        loop.notify('source-change');
        expect(loop.flush()?.materialize.classCount).toBe(1);
        expect(loop.lastError).toBeUndefined();
    });

    /**
     * The documented Next setup runs `csszyx next watch` beside `next dev`, and
     * the Turbopack loader takes the same lock for a cycle of its own. The
     * loader already yields to a watcher. This is the other direction: a
     * scheduled watcher cycle that lands inside the loader's critical section.
     *
     * Reporting it ended the watch process, and `concurrently
     * --kill-others-on-fail` — the documented way to run the pair — then killed
     * `next dev` with it. The cycle is retried rather than dropped, because the
     * loader's pass read the shards as they were when it started, and the
     * event that woke the watcher may be newer than that.
     *
     * @param command - what the holder calls itself on the lock file.
     * @returns the error a cycle throws when that holder is live.
     */
    function heldBy(command: string): NextSafelistStateLockedError {
        return new NextSafelistStateLockedError({
            version: 1,
            pid: 4242,
            token: 'holder-token',
            hostname: 'host',
            root: '/repo/apps/web',
            mode: 'development',
            command,
            startedAt: '2026-09-12T17:25:39.000Z',
            updatedAt: '2026-09-12T17:25:39.000Z',
        });
    }

    const RESULT = {
        materialize: { classCount: 3, sourceCount: 2, tombstonedSourceCount: 0, shardCount: 2 },
        manifestPath: '/manifest.json',
        lockPath: '/state.lock',
    };

    it('retries the cycle after the debounce when a Turbopack loader holds the lock', () => {
        const timers = scheduler();
        const errors: unknown[] = [];
        const calls: string[][] = [];
        const loop = new NextWatcherLoop({
            context: context(),
            debounceMs: 75,
            runCycle: (_context, _options, reasons) => {
                calls.push([...reasons]);
                if (calls.length === 1) {
                    throw heldBy('csszyx next turbo-loader');
                }
                return RESULT;
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
            onError: caught => {
                errors.push(caught);
            },
        });

        loop.notify('shard:add');
        timers.runAll();

        // Not a failure: nothing reported, and the same work is queued again.
        expect(errors).toEqual([]);
        expect(loop.lastError).toBeUndefined();
        expect(loop.pending).toBe(true);
        expect(loop.reasons).toEqual(['shard:add']);
        expect([...timers.pending.values()].map(task => task.delayMs)).toEqual([75]);

        timers.runAll();

        expect(calls).toEqual([['shard:add'], ['shard:add']]);
        expect(loop.lastResult).toBe(RESULT);
        expect(loop.pending).toBe(false);
        expect(errors).toEqual([]);
    });

    it('still reports a lock held by anything other than a loader', () => {
        const timers = scheduler();
        const errors: unknown[] = [];
        // A second watcher on the same root is a misconfiguration, not a race.
        const error = heldBy('csszyx next watch');
        const loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                throw error;
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
            onError: caught => {
                errors.push(caught);
            },
        });

        loop.notify('shard:change');
        timers.runAll();

        expect(errors).toEqual([error]);
        expect(loop.lastError).toBe(error);
        expect(loop.pending).toBe(false);
    });

    it('does not queue a retry once the loop is disposed', () => {
        const timers = scheduler();
        const errors: unknown[] = [];
        let loop: NextWatcherLoop | undefined;
        loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                // Shutdown lands while the loader holds the lock.
                loop?.dispose();
                throw heldBy('csszyx next turbo-loader');
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
            onError: caught => {
                errors.push(caught);
            },
        });

        loop.notify('shard:add');
        timers.runAll();

        expect(timers.pending.size).toBe(0);
        expect(loop.pending).toBe(false);
        expect(errors).toEqual([]);
    });

    /**
     * Run every due timer once, moving the clock forward by the longest delay
     * among them, the way real time would have passed.
     *
     * @param timers - The fake scheduler.
     * @param clock - The clock the loop reads.
     * @param clock.now - Milliseconds since the test began.
     */
    function tick(timers: ReturnType<typeof scheduler>, clock: { now: number }): void {
        const tasks = [...timers.pending.values()];
        timers.pending.clear();
        clock.now += Math.max(0, ...tasks.map(task => task.delayMs));
        for (const task of tasks) {
            task.callback();
        }
    }

    it('says nothing about an ordinary overlap with the loader', () => {
        const timers = scheduler();
        const clock = { now: 0 };
        const warnings: string[] = [];
        let attempts = 0;
        const loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                attempts += 1;
                if (attempts === 1) {
                    throw heldBy('csszyx next turbo-loader');
                }
                return RESULT;
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
            now: () => clock.now,
            onWarn: message => {
                warnings.push(message);
            },
        });

        loop.notify('shard:add');
        tick(timers, clock);
        tick(timers, clock);

        expect(loop.lastResult).toBe(RESULT);
        expect(warnings).toEqual([]);
    });

    it('warns once while a loader keeps the lock, then reports it past the limit', () => {
        const timers = scheduler();
        const clock = { now: 0 };
        const errors: unknown[] = [];
        const warnings: string[] = [];
        const error = heldBy('csszyx next turbo-loader');
        const loop = new NextWatcherLoop({
            context: context(),
            debounceMs: 50,
            runCycle: () => {
                throw error;
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
            now: () => clock.now,
            onError: caught => {
                errors.push(caught);
            },
            onWarn: message => {
                warnings.push(message);
            },
        });

        loop.notify('shard:add');
        tick(timers, clock);
        const firstRefusalAt = clock.now;
        while (clock.now - firstRefusalAt < LOADER_LOCK_WARN_AFTER_MS - 50) {
            tick(timers, clock);
        }
        expect(warnings).toEqual([]);

        while (warnings.length === 0 && clock.now < LOADER_LOCK_GIVE_UP_AFTER_MS) {
            tick(timers, clock);
        }
        // One warning naming who holds it, and the retries go on quietly.
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('Turbopack loader');
        expect(warnings[0]).toContain('4242');
        expect(errors).toEqual([]);
        expect(loop.pending).toBe(true);

        while (errors.length === 0 && clock.now < LOADER_LOCK_GIVE_UP_AFTER_MS * 2) {
            tick(timers, clock);
        }
        // Past the limit no live loader explains it any more: report, stop retrying.
        expect(errors).toEqual([error]);
        expect(clock.now - firstRefusalAt).toBeGreaterThan(LOADER_LOCK_GIVE_UP_AFTER_MS);
        expect(warnings).toHaveLength(1);
        expect(loop.pending).toBe(false);
    });

    it('counts a new wait from zero once the loader has let go', () => {
        const timers = scheduler();
        const clock = { now: 0 };
        const errors: unknown[] = [];
        const warnings: string[] = [];
        let holding = true;
        const loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                if (holding) {
                    throw heldBy('csszyx next turbo-loader');
                }
                return RESULT;
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
            now: () => clock.now,
            onError: caught => {
                errors.push(caught);
            },
            onWarn: message => {
                warnings.push(message);
            },
        });

        loop.notify('shard:add');
        while (warnings.length === 0 && clock.now < LOADER_LOCK_GIVE_UP_AFTER_MS) {
            tick(timers, clock);
        }
        holding = false;
        tick(timers, clock);
        expect(loop.lastResult).toBe(RESULT);

        // A later overlap is a new wait: no instant warning, no instant give-up.
        holding = true;
        clock.now += LOADER_LOCK_GIVE_UP_AFTER_MS;
        loop.notify('shard:change');
        tick(timers, clock);
        expect(errors).toEqual([]);
        expect(warnings).toHaveLength(1);
        expect(loop.pending).toBe(true);
    });

    it('retries no faster than the floor when the debounce is zero', () => {
        const timers = scheduler();
        let attempts = 0;
        const loop = new NextWatcherLoop({
            context: context(),
            debounceMs: 0,
            runCycle: () => {
                attempts += 1;
                if (attempts === 1) {
                    throw heldBy('csszyx next turbo-loader');
                }
                return RESULT;
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });

        loop.notify('shard:add');
        expect([...timers.pending.values()].map(task => task.delayMs)).toEqual([0]);
        timers.runAll();

        expect([...timers.pending.values()].map(task => task.delayMs)).toEqual([
            LOADER_LOCK_RETRY_MIN_MS,
        ]);
    });

    it('keeps waiting quietly when nothing listens for notices', () => {
        const timers = scheduler();
        const clock = { now: 0 };
        const errors: unknown[] = [];
        const loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                throw heldBy('csszyx next turbo-loader');
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
            now: () => clock.now,
            onError: caught => {
                errors.push(caught);
            },
        });

        loop.notify('shard:add');
        while (clock.now < LOADER_LOCK_WARN_AFTER_MS * 2) {
            tick(timers, clock);
        }

        expect(errors).toEqual([]);
        expect(loop.pending).toBe(true);
    });

    it('has nothing to flush or queue when nothing is pending, or once disposed', () => {
        const timers = scheduler();
        let attempts = 0;
        const loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                attempts += 1;
                return RESULT;
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });

        expect(loop.flushOrQueue()).toBeUndefined();
        loop.notify('shard:add');
        loop.dispose();
        expect(loop.flushOrQueue()).toBeUndefined();
        expect(attempts).toBe(0);
    });

    it('clears pending work and ignores new events after dispose', () => {
        const timers = scheduler();
        let callCount = 0;
        const loop = new NextWatcherLoop({
            context: context(),
            runCycle: () => {
                callCount += 1;
                throw new Error('should not run');
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });

        loop.notify('source-change');
        loop.dispose();
        loop.notify('pending-shard');
        timers.runAll();

        expect(callCount).toBe(0);
        expect(loop.pending).toBe(false);
        expect(loop.reasons).toEqual([]);
        expect(loop.flush()).toBeUndefined();
    });
});
