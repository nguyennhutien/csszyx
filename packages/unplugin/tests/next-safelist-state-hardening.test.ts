/**
 * The safelist state store's crash-hardening paths: garbage shards are removed
 * instead of poisoning materialization, invalid lock metadata reads as null,
 * the stale advisory-lock recovery election, and the real liveness probe.
 */
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    acquireNextSafelistStateLock,
    materializeNextSafelist,
    readNextSafelistStateLockMetadata,
    resolveNextSafelistStatePaths,
    writeNextSafelistShard,
} from '../src/next-safelist-state.js';

const tempDirs: string[] = [];
function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'csszyx-sls-hardening-'));
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('materializeNextSafelist over a polluted shards directory', () => {
    it('drops non-json entries, corrupt json, and schema-invalid shards', () => {
        const root = tempRoot();
        const paths = resolveNextSafelistStatePaths(root);
        mkdirSync(paths.shardsDir, { recursive: true });

        // A real shard for an existing source.
        const source = join(root, 'App.tsx');
        writeFileSync(source, 'x');
        writeNextSafelistShard(
            paths.shardsDir,
            { sourcePath: source, sourceHash: 'h1', classes: ['p-4'] },
            { retryDelayMs: 0 },
        );
        // Pollution: a directory, a stray file, corrupt json, invalid schema.
        mkdirSync(join(paths.shardsDir, 'not-a-file.json'));
        writeFileSync(join(paths.shardsDir, 'notes.txt'), 'ignore me');
        writeFileSync(join(paths.shardsDir, 'corrupt.json'), '{ nope');
        writeFileSync(join(paths.shardsDir, 'invalid.json'), JSON.stringify({ version: 99 }));
        // A shard whose source no longer exists — tombstoned.
        writeNextSafelistShard(
            paths.shardsDir,
            { sourcePath: join(root, 'Gone.tsx'), sourceHash: 'h2', classes: ['m-2'] },
            { retryDelayMs: 0 },
        );

        const result = materializeNextSafelist(paths, { retryDelayMs: 0 });
        expect(result.classCount).toBe(1);
        expect(result.sourceCount).toBe(1);
        expect(result.tombstonedSourceCount).toBe(1);
        // The garbage json shards were deleted; the stray txt survives untouched.
        const names = readdirSync(paths.shardsDir).sort();
        expect(names).not.toContain('corrupt.json');
        expect(names).not.toContain('invalid.json');
        expect(names).toContain('notes.txt');
    });

    it('returns empty totals when the shards directory does not exist', () => {
        const paths = resolveNextSafelistStatePaths(tempRoot());
        const result = materializeNextSafelist(paths, { retryDelayMs: 0 });
        expect(result).toEqual({
            classCount: 0,
            sourceCount: 0,
            tombstonedSourceCount: 0,
            shardCount: 0,
        });
    });
});

describe('readNextSafelistStateLockMetadata', () => {
    it('reads back what acquire wrote, and null for absent/corrupt/invalid files', () => {
        const root = tempRoot();
        const lockPath = join(root, 'state.lock.json');
        expect(readNextSafelistStateLockMetadata(lockPath)).toBeNull();

        const lock = acquireNextSafelistStateLock(lockPath, {
            root,
            mode: 'development',
            command: 'test',
        });
        const metadata = readNextSafelistStateLockMetadata(lockPath);
        expect(metadata?.command).toBe('test');
        expect(metadata?.pid).toBe(process.pid);
        lock.release();

        writeFileSync(lockPath, '{ nope');
        expect(readNextSafelistStateLockMetadata(lockPath)).toBeNull();
        writeFileSync(lockPath, JSON.stringify({ version: 1, pid: 'NaN' }));
        expect(readNextSafelistStateLockMetadata(lockPath)).toBeNull();
    });
});

describe('lock liveness against the real process table', () => {
    it('refuses while the owner process is alive, recovers once it is gone', () => {
        const root = tempRoot();
        const lockPath = join(root, 'state.lock.json');
        // Same host + our own live pid → the default probe sees a live owner.
        const live = acquireNextSafelistStateLock(lockPath, {
            root,
            mode: 'development',
            command: 'held',
        });
        expect(() =>
            acquireNextSafelistStateLock(lockPath, {
                root,
                mode: 'development',
                command: 'contender',
            }),
        ).toThrow(/already/);
        live.release();

        // A dead pid on this host is recovered by the default probe.
        const stale = acquireNextSafelistStateLock(lockPath, {
            root,
            mode: 'development',
            command: 'crashed',
            pid: 2 ** 30,
        });
        stale.release();
        const recovered = acquireNextSafelistStateLock(lockPath, {
            root,
            mode: 'development',
            command: 'recoverer',
        });
        recovered.release();
    });

    it('elects a single recoverer for a stale advisory lock directory', () => {
        const root = tempRoot();
        const lockPath = join(root, 'state.lock.json');
        // Simulate a crashed owner: a stale advisory dir with an old mtime.
        const advisory = `${lockPath}.lock`;
        mkdirSync(advisory, { recursive: true });
        const old = (Date.now() - 60 * 60 * 1000) / 1000;
        utimesSync(advisory, old, old);
        expect(statSync(advisory).isDirectory()).toBe(true);

        const lock = acquireNextSafelistStateLock(lockPath, {
            root,
            mode: 'development',
            command: 'after-crash',
            staleAfterMs: 1000,
        });
        lock.release();
    });
});
