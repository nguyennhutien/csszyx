import { describe, expect, it } from 'vitest';

import { createNextStateContext } from '../src/next-state-context.js';
import { NextWatcherLoop, type NextWatcherLoopCycleRunner } from '../src/next-watcher-loop.js';

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
