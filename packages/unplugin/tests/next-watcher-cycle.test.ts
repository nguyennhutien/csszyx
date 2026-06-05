import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    readNextGenerationManifest,
    validateNextGenerationManifest,
} from '../src/next-generation-manifest.js';
import { writeNextSafelistShard } from '../src/next-safelist-state.js';
import { createNextStateContext } from '../src/next-state-context.js';
import { runNextWatcherCycle } from '../src/next-watcher-cycle.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Next watcher cycle', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-cycle-'));
        tempDirs.push(dir);
        return dir;
    }

    function context(root: string) {
        return createNextStateContext({
            explicitRoot: root,
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
        });
    }

    it('materializes shards and writes a valid generation manifest', () => {
        const root = tempRoot();
        const ctx = context(root);
        const sourcePath = join(root, 'src/App.tsx');
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(sourcePath, 'export function App() {}', 'utf8');
        writeNextSafelistShard(ctx.safelist.shardsDir, {
            sourcePath,
            sourceHash: 'hash-a',
            classes: ['p-4', 'flex'],
        });

        const result = runNextWatcherCycle(ctx, {
            createdAt: '2026-06-04T00:00:00.000Z',
            lockOptions: {
                pid: 123,
                token: 'cycle-token',
                now: Date.parse('2026-06-04T00:00:00.000Z'),
            },
            writeOptions: { retryDelayMs: 0 },
        });

        expect(result.materialize).toMatchObject({
            classCount: 2,
            sourceCount: 1,
            tombstonedSourceCount: 0,
            shardCount: 1,
        });
        expect(readFileSync(ctx.safelist.outputPath, 'utf8')).toContain('p-4');
        const manifest = readNextGenerationManifest(ctx.manifestPath);
        expect(manifest?.sourceCount).toBe(1);
        expect(manifest?.generation).toBe(ctx.identity.generation);
        expect(validateNextGenerationManifest(manifest, ctx.manifestExpectation)).toEqual({
            ok: true,
        });
        expect(existsSync(result.lockPath)).toBe(false);
    });

    it('fails when a live watcher already owns the lock', () => {
        const root = tempRoot();
        const ctx = context(root);
        mkdirSync(ctx.cacheDir, { recursive: true });
        writeFileSync(
            join(ctx.cacheDir, 'state.lock'),
            `${JSON.stringify(
                {
                    version: 1,
                    pid: 999,
                    token: 'live-token',
                    hostname: 'host',
                    root,
                    mode: 'development',
                    command: 'csszyx next watch',
                    startedAt: '2026-06-04T00:00:00.000Z',
                    updatedAt: '2026-06-04T00:00:00.000Z',
                },
                null,
                2,
            )}\n`,
            'utf8',
        );

        expect(() =>
            runNextWatcherCycle(ctx, {
                lockOptions: {
                    now: Date.parse('2026-06-04T00:00:01.000Z'),
                    isProcessAlive: () => true,
                },
            }),
        ).toThrow(/already locked/);
    });

    it('tombstones deleted source shards during materialization', () => {
        const root = tempRoot();
        const ctx = context(root);
        const sourcePath = join(root, 'src/Deleted.tsx');
        writeNextSafelistShard(ctx.safelist.shardsDir, {
            sourcePath,
            sourceHash: 'hash-a',
            classes: ['p-8'],
        });

        const result = runNextWatcherCycle(ctx, {
            writeOptions: { retryDelayMs: 0 },
        });

        expect(result.materialize.tombstonedSourceCount).toBe(1);
        expect(result.materialize.classCount).toBe(0);
        expect(readFileSync(ctx.safelist.outputPath, 'utf8')).toBe(
            '<!-- csszyx Next safelist: empty -->\n',
        );
    });
});
