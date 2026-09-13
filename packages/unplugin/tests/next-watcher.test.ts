import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    acquireNextSafelistStateLock,
    NEXT_TURBO_LOADER_LOCK_COMMAND,
    NextSafelistStateLockedError,
} from '../src/next-safelist-state.js';
import { createNextStateContext } from '../src/next-state-context.js';
import {
    isNextAppSourcePath,
    isNextSafelistShardPath,
    NextSafelistWatcher,
} from '../src/next-watcher.js';
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

        expect(watcher.start()?.materialize.classCount).toBe(2);
        expect(watcher.start()?.materialize.classCount).toBe(2);
        expect(reasons).toEqual([['initial']]);
        expect(watcher.pending).toBe(false);
    });

    /**
     * `next watch` and `next dev` start together in the documented setup, so the
     * loader's first compile can hold the lock exactly when the watcher runs its
     * initial cycle. That cycle used to throw and end the watch process.
     *
     * @param command - What the holder records on the lock.
     * @returns The error a cycle throws while that holder is live.
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
            startedAt: '2026-09-13T00:00:00.000Z',
            updatedAt: '2026-09-13T00:00:00.000Z',
        });
    }

    it('queues the initial cycle instead of throwing when the Turbopack loader holds the lock', () => {
        const timers = scheduler();
        let attempts = 0;
        const watcher = new NextSafelistWatcher({
            context: context(),
            runCycle: () => {
                attempts += 1;
                if (attempts === 1) {
                    throw heldBy(NEXT_TURBO_LOADER_LOCK_COMMAND);
                }
                return cycleResult(3);
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });

        expect(watcher.start()).toBeUndefined();
        expect(watcher.pending).toBe(true);
        expect(watcher.lastResult).toBeUndefined();

        timers.runAll();
        expect(watcher.lastResult?.materialize.classCount).toBe(3);
        // The queued cycle ran as the initial one, so start() does not run it again.
        expect(watcher.start()?.materialize.classCount).toBe(3);
        expect(attempts).toBe(2);
    });

    it('still throws from start when anything but the loader holds the lock', () => {
        const watcher = new NextSafelistWatcher({
            context: context(),
            runCycle: () => {
                throw heldBy('csszyx next watch');
            },
        });

        expect(() => watcher.start()).toThrow(/already locked by process 4242/);
    });

    it('starts against a real lock the loader holds, and materializes once it lets go', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'csszyx-watcher-start-'));
        try {
            const timers = scheduler();
            const errors: unknown[] = [];
            const ctx = createNextStateContext({
                explicitRoot: root,
                config: { mangleVars: false },
                nextVersion: '16.2.7',
                csszyxVersion: '0.9.0',
                nativeVersion: '0.9.0-test',
                mode: 'development',
            });
            const lock = acquireNextSafelistStateLock(path.join(ctx.cacheDir, 'state.lock'), {
                root: ctx.root,
                mode: 'development',
                command: NEXT_TURBO_LOADER_LOCK_COMMAND,
            });
            const watcher = new NextSafelistWatcher({
                context: ctx,
                setTimeout: timers.setTimeout,
                clearTimeout: timers.clearTimeout,
                onError: caught => {
                    errors.push(caught);
                },
            });

            try {
                expect(watcher.start()).toBeUndefined();
                expect(watcher.pending).toBe(true);
            } finally {
                lock.release();
            }

            timers.runAll();
            expect(errors).toEqual([]);
            expect(watcher.lastResult?.materialize.sourceCount).toBe(0);
            expect(watcher.pending).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('says the initial cycle failed when the runner hands back nothing', () => {
        const watcher = new NextSafelistWatcher({
            context: context(),
            // A runner supplied from outside can break its own contract; the
            // watcher must not carry on as if a first pass had happened.
            runCycle: () => undefined as never,
        });

        expect(() => watcher.start()).toThrow('failed to run its initial cycle');
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

    it('accepts source removal paths only inside the app root', () => {
        const root = context().root;

        expect(isNextAppSourcePath(root, path.join(root, 'src/App.tsx'))).toBe(true);
        expect(isNextAppSourcePath(root, path.join(root, 'src/nested/Card.tsx'))).toBe(true);
        expect(isNextAppSourcePath(root, path.join(root, '.generated/App.tsx'))).toBe(true);
        expect(isNextAppSourcePath(root, path.join(root, '..', 'docs/src/App.tsx'))).toBe(false);
        expect(isNextAppSourcePath(root, 'src/App.tsx')).toBe(false);
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

    it('coalesces in-root source removal with shard events for tombstone cleanup', () => {
        const timers = scheduler();
        const reasons: readonly string[][] = [];
        const ctx = context();
        const watcher = new NextSafelistWatcher({
            context: ctx,
            runCycle: (_context, _options, cycleReasons) => {
                (reasons as string[][]).push([...cycleReasons]);
                return cycleResult(reasons.length);
            },
            setTimeout: timers.setTimeout,
            clearTimeout: timers.clearTimeout,
        });
        watcher.start();

        expect(watcher.notifySourceRemoval(path.join(ctx.root, 'src/App.tsx'))).toBe(true);
        expect(watcher.notifySourceRemoval(path.join(ctx.root, '..', 'docs/src/App.tsx'))).toBe(
            false,
        );
        watcher.notify('unlink', path.join(ctx.safelist.shardsDir, 'a.json'));
        timers.runAll();

        expect(reasons).toEqual([['initial'], ['source:unlink', 'shard:unlink']]);
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

describe('NextSafelistWatcher accessors and flush', () => {
    it('exposes pending, lastResult and lastError through the loop', () => {
        const watcher = new NextSafelistWatcher({
            context: createNextStateContext({
                explicitRoot: '/repo/apps/web',
                config: { mangleVars: false },
                nextVersion: '16.2.7',
                csszyxVersion: '0.9.0',
                nativeVersion: '0.9.0-linux-arm64-gnu',
                mode: 'development',
            }),
            runCycle: () => {
                return {
                    materialize: {
                        classCount: 1,
                        sourceCount: 1,
                        tombstonedSourceCount: 0,
                        shardCount: 1,
                    },
                    manifestPath: '/repo/x.json',
                    lockPath: '/repo/x.lock',
                };
            },
        });
        expect(watcher.lastResult).toBeUndefined();
        expect(watcher.lastError).toBeUndefined();

        watcher.start();
        expect(watcher.lastResult?.materialize.classCount).toBe(1);
        expect(watcher.flush()).toBeUndefined(); // nothing pending

        // A shard event queues work; flush drains it through another cycle.
        expect(
            watcher.notify('change', '/repo/apps/web/.csszyx/cache/safelist-shards/a.json'),
        ).toBe(true);
        expect(watcher.pending).toBe(true);
        expect(watcher.flush()?.materialize.classCount).toBe(1);
        expect(watcher.lastError).toBeUndefined();
    });
});
