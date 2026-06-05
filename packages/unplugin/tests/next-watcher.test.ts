import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createNextStateContext } from '../src/next-state-context.js';
import { isNextSafelistShardPath, NextSafelistWatcher } from '../src/next-watcher.js';
import type { NextWatcherLoopCycleRunner } from '../src/next-watcher-loop.js';

describe('Next safelist watcher controller', () => {
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
                const tasks = [...pending.values()];
                pending.clear();
                for (const task of tasks) {
                    task.callback();
                }
            },
        };
    }

    function cycleResult(classCount: number) {
        return {
            materialize: {
                classCount,
                sourceCount: classCount > 0 ? 1 : 0,
                tombstonedSourceCount: 0,
                shardCount: classCount > 0 ? 1 : 0,
            },
            manifestPath: '/repo/apps/web/.csszyx/cache/generation-manifest.json',
            lockPath: '/repo/apps/web/.csszyx/cache/state.lock',
        };
    }

    it('runs an immediate initial materialization exactly once', () => {
        const reasons: readonly string[][] = [];
        const watcher = new NextSafelistWatcher({
            context: context(),
            runCycle: (_context, _options, cycleReasons) => {
                (reasons as string[][]).push([...cycleReasons]);
                return cycleResult(2);
            },
        });

        expect(watcher.start().materialize.classCount).toBe(2);
        expect(watcher.start().materialize.classCount).toBe(2);
        expect(reasons).toEqual([['initial']]);
        expect(watcher.pending).toBe(false);
    });

    it('accepts only direct absolute JSON shard paths', () => {
        const shardsDir = context().safelist.shardsDir;

        expect(isNextSafelistShardPath(shardsDir, path.join(shardsDir, 'abc.json'))).toBe(true);
        expect(isNextSafelistShardPath(shardsDir, path.join(shardsDir, '.tmp-abc.json-1'))).toBe(
            false,
        );
        expect(isNextSafelistShardPath(shardsDir, path.join(shardsDir, 'nested', 'abc.json'))).toBe(
            false,
        );
        expect(isNextSafelistShardPath(shardsDir, path.join(shardsDir, '..', 'outside.json'))).toBe(
            false,
        );
        expect(isNextSafelistShardPath(shardsDir, 'abc.json')).toBe(false);
    });

    it('coalesces relevant shard events and ignores unrelated cache events', () => {
        const timers = scheduler();
        const reasons: readonly string[][] = [];
        const ctx = context();
        const watcher = new NextSafelistWatcher({
            context: ctx,
            debounceMs: 80,
            runCycle: (_context, _options, cycleReasons) => {
                (reasons as string[][]).push([...cycleReasons]);
                return cycleResult(reasons.length);
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });
        watcher.start();

        expect(watcher.notify('add', path.join(ctx.safelist.shardsDir, 'a.json'))).toBe(true);
        expect(watcher.notify('change', path.join(ctx.safelist.shardsDir, 'a.json'))).toBe(true);
        expect(watcher.notify('unlink', path.join(ctx.safelist.shardsDir, 'b.json'))).toBe(true);
        expect(watcher.notify('change', ctx.manifestPath)).toBe(false);
        expect(watcher.pending).toBe(true);
        expect([...timers.pending.values()].map(task => task.delayMs)).toEqual([80]);

        timers.runAll();

        expect(reasons).toEqual([['initial'], ['shard:add', 'shard:change', 'shard:unlink']]);
        expect(watcher.pending).toBe(false);
    });

    it('flushes pending work on close and rejects later events', () => {
        const timers = scheduler();
        let callCount = 0;
        const ctx = context();
        const runCycle: NextWatcherLoopCycleRunner = () => {
            callCount++;
            return cycleResult(callCount);
        };
        const watcher = new NextSafelistWatcher({
            context: ctx,
            runCycle,
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });
        watcher.start();
        watcher.notify('change', path.join(ctx.safelist.shardsDir, 'a.json'));

        expect(watcher.close()?.materialize.classCount).toBe(2);
        expect(watcher.close()).toBeUndefined();
        expect(watcher.notify('change', path.join(ctx.safelist.shardsDir, 'b.json'))).toBe(false);

        timers.runAll();
        expect(callCount).toBe(2);
    });

    it('cannot restart after close or accept events before start', () => {
        const ctx = context();
        const watcher = new NextSafelistWatcher({
            context: ctx,
            runCycle: () => cycleResult(0),
        });

        expect(watcher.notify('add', path.join(ctx.safelist.shardsDir, 'a.json'))).toBe(false);
        watcher.close();
        expect(() => watcher.start()).toThrow('Cannot start a closed Next safelist watcher');
    });
});
