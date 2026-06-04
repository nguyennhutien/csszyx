import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    acquireNextSafelistStateLock,
    atomicRenameWithRetry,
    materializeNextSafelist,
    readNextSafelistStateLockMetadata,
    resolveNextSafelistStatePaths,
    writeNextSafelistShard,
} from '../src/next-safelist-state.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Next safelist state', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-safelist-'));
        tempDirs.push(dir);
        return dir;
    }

    it('resolves cache state under the explicit project root', () => {
        const root = tempRoot();
        const paths = resolveNextSafelistStatePaths(root);

        expect(paths.cacheDir).toBe(join(root, '.csszyx/cache'));
        expect(paths.shardsDir).toBe(join(root, '.csszyx/cache/safelist-shards'));
        expect(paths.snapshotPath).toBe(join(root, '.csszyx/cache/safelist.snapshot.json'));
        expect(paths.outputPath).toBe(join(root, 'csszyx-classes.html'));
    });

    it('merges source shards into a deterministic Tailwind source file', () => {
        const root = tempRoot();
        const sourcePath = join(root, 'src/App.tsx');
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(sourcePath, 'export function App() {}', { flag: 'wx' });
        const paths = resolveNextSafelistStatePaths(root);

        writeNextSafelistShard(
            paths.shardsDir,
            {
                sourcePath,
                sourceHash: 'hash-a',
                classes: ['p-8', 'bg-red-500', 'p-8'],
                timestamp: 1,
            },
            { retryDelayMs: 0 },
        );

        const result = materializeNextSafelist(paths, { retryDelayMs: 0 });

        expect(result).toEqual({
            classCount: 2,
            sourceCount: 1,
            tombstonedSourceCount: 0,
            shardCount: 1,
        });
        expect(readFileSync(paths.outputPath, 'utf8')).toBe(
            '<div class="bg-red-500"></div>\n<div class="p-8"></div>\n',
        );
        expect(readFileSync(paths.snapshotPath, 'utf8')).toContain(sourcePath);
    });

    it('ignores corrupt shard files without dropping valid shards', () => {
        const root = tempRoot();
        const sourcePath = join(root, 'src/App.tsx');
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(sourcePath, 'export function App() {}', { flag: 'wx' });
        const paths = resolveNextSafelistStatePaths(root);

        mkdirSync(paths.shardsDir, { recursive: true });
        writeFileSync(join(paths.shardsDir, 'bad.json'), '{bad json\n', 'utf8');
        writeNextSafelistShard(paths.shardsDir, {
            sourcePath,
            sourceHash: 'hash-a',
            classes: ['p-4'],
        });

        const result = materializeNextSafelist(paths, { retryDelayMs: 0 });

        expect(result.classCount).toBe(1);
        expect(result.shardCount).toBe(1);
        expect(readFileSync(paths.outputPath, 'utf8')).toContain('p-4');
    });

    it('tombstones snapshot sources when the original file is deleted', () => {
        const root = tempRoot();
        const sourcePath = join(root, 'src/Button.tsx');
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(sourcePath, 'export function Button() {}', { flag: 'wx' });
        const paths = resolveNextSafelistStatePaths(root);

        writeNextSafelistShard(paths.shardsDir, {
            sourcePath,
            sourceHash: 'hash-a',
            classes: ['p-8'],
        });
        materializeNextSafelist(paths, { retryDelayMs: 0 });
        rmSync(sourcePath);

        const result = materializeNextSafelist(paths, { retryDelayMs: 0 });

        expect(result.tombstonedSourceCount).toBe(1);
        expect(result.classCount).toBe(0);
        expect(readFileSync(paths.outputPath, 'utf8')).toBe(
            '<!-- csszyx Next safelist: empty -->\n',
        );
        expect(readFileSync(paths.snapshotPath, 'utf8')).not.toContain(sourcePath);
    });

    it('replaces a source class set when a newer shard for the same file appears', () => {
        const root = tempRoot();
        const sourcePath = join(root, 'src/Card.tsx');
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(sourcePath, 'export function Card() {}', { flag: 'wx' });
        const paths = resolveNextSafelistStatePaths(root);

        writeNextSafelistShard(paths.shardsDir, {
            cacheKey: 'old',
            sourcePath,
            sourceHash: 'hash-a',
            classes: ['p-4', 'bg-red-500'],
            timestamp: 1,
        });
        writeNextSafelistShard(paths.shardsDir, {
            cacheKey: 'new',
            sourcePath,
            sourceHash: 'hash-b',
            classes: ['p-2'],
            timestamp: 2,
        });

        materializeNextSafelist(paths, { retryDelayMs: 0 });

        const output = readFileSync(paths.outputPath, 'utf8');
        expect(output).toContain('p-2');
        expect(output).not.toContain('p-4');
        expect(output).not.toContain('bg-red-500');
    });

    it('recovers stale metadata locks and refuses live locks', () => {
        const root = tempRoot();
        const lockPath = join(root, '.csszyx/cache/state.lock');
        mkdirSync(join(root, '.csszyx/cache'), { recursive: true });
        writeFileSync(
            lockPath,
            `${JSON.stringify(
                {
                    version: 1,
                    pid: 999999999,
                    token: 'stale-token',
                    hostname: 'host',
                    root,
                    mode: 'development',
                    command: 'old',
                    startedAt: '2026-06-04T00:00:00.000Z',
                    updatedAt: '2026-06-04T00:00:00.000Z',
                },
                null,
                2,
            )}\n`,
            { encoding: 'utf8', flag: 'w' },
        );

        const recovered = acquireNextSafelistStateLock(lockPath, {
            pid: 123,
            root,
            command: 'csszyx next watch',
            now: Date.parse('2026-06-04T00:01:00.000Z'),
            staleAfterMs: 1_000,
            isProcessAlive: () => true,
            token: 'new-token',
        });

        expect(readNextSafelistStateLockMetadata(lockPath)?.token).toBe('new-token');
        expect(() =>
            acquireNextSafelistStateLock(lockPath, {
                pid: 456,
                root,
                now: Date.parse('2026-06-04T00:01:00.000Z'),
                isProcessAlive: () => true,
            }),
        ).toThrow(/already locked/);

        recovered.release();
        expect(existsSync(lockPath)).toBe(false);
    });

    it('heartbeats active lock metadata', () => {
        const root = tempRoot();
        const lockPath = join(root, '.csszyx/cache/state.lock');
        const lock = acquireNextSafelistStateLock(lockPath, {
            pid: 123,
            root,
            now: Date.parse('2026-06-04T00:00:00.000Z'),
            token: 'heartbeat-token',
        });

        lock.heartbeat();

        expect(readNextSafelistStateLockMetadata(lockPath)?.updatedAt).toBe(
            '2026-06-04T00:00:00.000Z',
        );
        lock.release();
    });

    it('does not release a lock owned by another token', () => {
        const root = tempRoot();
        const lockPath = join(root, '.csszyx/cache/state.lock');
        const lock = acquireNextSafelistStateLock(lockPath, {
            pid: 123,
            root,
            token: 'first-token',
        });

        writeFileSync(
            lockPath,
            `${JSON.stringify(
                {
                    ...readNextSafelistStateLockMetadata(lockPath),
                    token: 'second-token',
                    pid: 456,
                },
                null,
                2,
            )}\n`,
            'utf8',
        );
        lock.release();

        expect(readNextSafelistStateLockMetadata(lockPath)?.token).toBe('second-token');
    });

    it('retries transient Windows rename failures', () => {
        const root = tempRoot();
        const from = join(root, 'file.tmp');
        const to = join(root, 'file.txt');
        let attempts = 0;
        writeFileSync(from, 'ok', 'utf8');

        const transientCodes = ['EPERM', 'EBUSY', 'EACCES'];

        atomicRenameWithRetry(from, to, {
            retryDelayMs: 0,
            renameSync: (tmp, file) => {
                attempts++;
                if (attempts <= transientCodes.length) {
                    const error = new Error('locked') as NodeJS.ErrnoException;
                    error.code = transientCodes[attempts - 1];
                    throw error;
                }
                writeFileSync(file, readFileSync(tmp, 'utf8'), 'utf8');
                rmSync(tmp);
            },
        });

        expect(attempts).toBe(4);
        expect(readFileSync(to, 'utf8')).toBe('ok');
    });

    // Path-collision policy tests below. These pin the current "source paths
    // are case-sensitive opaque strings" contract so a future implementation
    // change to add normalization is an intentional decision, not an
    // accidental regression. Cross-platform users who run csszyx on
    // case-insensitive filesystems (default NTFS, default macOS APFS) must
    // keep their source file casing consistent across the build.
    it('treats source paths as case-sensitive: Foo.tsx and foo.tsx produce distinct shards', () => {
        const root = tempRoot();
        const paths = resolveNextSafelistStatePaths(root);
        mkdirSync(paths.shardsDir, { recursive: true });

        const upperShard = writeNextSafelistShard(paths.shardsDir, {
            sourcePath: join(root, 'Foo.tsx'),
            sourceHash: 'shared-hash',
            classes: ['p-4'],
        });
        const lowerShard = writeNextSafelistShard(paths.shardsDir, {
            sourcePath: join(root, 'foo.tsx'),
            sourceHash: 'shared-hash',
            classes: ['p-8'],
        });

        expect(upperShard.filePath).not.toBe(lowerShard.filePath);
        expect(upperShard.changed).toBe(true);
        expect(lowerShard.changed).toBe(true);
        expect(existsSync(upperShard.filePath)).toBe(true);
        expect(existsSync(lowerShard.filePath)).toBe(true);
    });

    it('treats path separators as part of the cache key: explicit cacheKey collision is the only mechanism for cross-OS aliasing', () => {
        // The cache key auto-derive path hashes `path.resolve(sourcePath)` +
        // `sourceHash`. Equal sourceHash but different resolved paths must
        // yield different cache keys, so a Windows build that accidentally
        // emits the same conceptual file under two path strings still keeps
        // each variant addressable. Users who need cross-OS aliasing must
        // pass an explicit `cacheKey` themselves; csszyx never invents one.
        const root = tempRoot();
        const paths = resolveNextSafelistStatePaths(root);
        mkdirSync(paths.shardsDir, { recursive: true });

        const nested = writeNextSafelistShard(paths.shardsDir, {
            sourcePath: join(root, 'dir', 'page.tsx'),
            sourceHash: 'shared-hash',
            classes: ['p-4'],
        });
        const flat = writeNextSafelistShard(paths.shardsDir, {
            // Sibling string that does not contain the OS path separator —
            // node:path treats this as one filename, so the resolved path
            // differs from the nested one above.
            sourcePath: join(root, 'dir__page.tsx'),
            sourceHash: 'shared-hash',
            classes: ['p-4'],
        });

        expect(nested.filePath).not.toBe(flat.filePath);

        // Explicit cacheKey collision: two callers can opt into sharing one
        // shard slot when they know two source paths address one logical file
        // (e.g. mid-build os.path normalization). The second write overwrites
        // the first because the cache key is identical and the equivalence
        // check sees a different sourcePath/sourceHash on disk.
        const explicitKey = 'shared-explicit-key';
        const firstWrite = writeNextSafelistShard(paths.shardsDir, {
            sourcePath: join(root, 'aliased', 'page.tsx'),
            sourceHash: 'h1',
            classes: ['p-4'],
            cacheKey: explicitKey,
        });
        const secondWrite = writeNextSafelistShard(paths.shardsDir, {
            sourcePath: join(root, 'AliasED', 'PAGE.tsx'),
            sourceHash: 'h2',
            classes: ['p-8'],
            cacheKey: explicitKey,
        });
        expect(firstWrite.filePath).toBe(secondWrite.filePath);
        expect(firstWrite.changed).toBe(true);
        expect(secondWrite.changed).toBe(true);
        const finalClasses = JSON.parse(readFileSync(secondWrite.filePath, 'utf8')).classes;
        expect(finalClasses).toEqual(['p-8']);
    });

    it('reports `changed: false` when the same shard content is rewritten', () => {
        const root = tempRoot();
        const sourcePath = join(root, 'src/Same.tsx');
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(sourcePath, 'export function Same() {}', { flag: 'wx' });
        const paths = resolveNextSafelistStatePaths(root);

        const firstWrite = writeNextSafelistShard(paths.shardsDir, {
            sourcePath,
            sourceHash: 'hash-same',
            classes: ['p-4'],
        });
        const secondWrite = writeNextSafelistShard(paths.shardsDir, {
            sourcePath,
            sourceHash: 'hash-same',
            classes: ['p-4'],
        });

        expect(firstWrite.changed).toBe(true);
        expect(secondWrite.changed).toBe(false);
        expect(secondWrite.filePath).toBe(firstWrite.filePath);
    });
});
