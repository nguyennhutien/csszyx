import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    acquireNextSafelistStateLock,
    atomicRenameWithRetry,
    atomicWriteFileSync,
    materializeNextSafelist,
    NEXT_SAFELIST_SHARD_FORMAT,
    NEXT_SAFELIST_SHARD_READ_FORMAT,
    readNextSafelistStateLockMetadata,
    resolveNextSafelistStatePaths,
    writeNextSafelistShard,
} from '../src/next-safelist-state.js';
import { SAFELIST_HEADER } from '../src/safelist-format.js';

const tempDirs: string[] = [];

/**
 * The shard check of the 0.17.2 reader, copied from
 * `git show v0.17.2:packages/unplugin/src/next-safelist-state.ts`
 * (`normalizeShardRecord`): it deleted every shard this returns null for.
 * Kept verbatim as the old reader a shard written now has to pass.
 *
 * @param data - A parsed shard.
 * @returns The fields that reader kept, or null for a shard it deleted.
 */
function readShardAs0172(data: Record<string, unknown>): { classes: unknown[] } | null {
    if (
        data.version !== 1 ||
        typeof data.cacheKey !== 'string' ||
        typeof data.sourcePath !== 'string' ||
        typeof data.sourceHash !== 'string' ||
        !Array.isArray(data.classes) ||
        typeof data.timestamp !== 'number' ||
        typeof data.pid !== 'number'
    ) {
        return null;
    }
    return { classes: data.classes };
}

/** Where a source writes `{ p: 8 }`: line 3, column 7. */
const SITE_P8 = { className: 'p-8', line: 3, column: 7, key: 'p' };

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
        expect(paths.outputPath).toBe(join(root, '.csszyx/csszyx-classes.txt'));
    });

    it('names every source of a class in path order, at the key each writes it', () => {
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        const paths = resolveNextSafelistStatePaths(root);
        for (const name of ['B.tsx', 'A.tsx']) {
            const sourcePath = join(root, 'src', name);
            writeFileSync(sourcePath, 'export {}');
            writeNextSafelistShard(
                paths.shardsDir,
                {
                    sourcePath,
                    sourceHash: name,
                    classes: ['p-8', `only-${name}`],
                    classSites: name === 'B.tsx' ? [SITE_P8] : [],
                    timestamp: 1,
                },
                { retryDelayMs: 0 },
            );
        }

        const { classOrigins } = materializeNextSafelist(paths, { retryDelayMs: 0 });

        expect(classOrigins.get('p-8')).toEqual([
            { sourcePath: join(root, 'src/A.tsx') },
            { sourcePath: join(root, 'src/B.tsx'), line: 3, column: 7, key: 'p' },
        ]);
        expect(classOrigins.get('only-B.tsx')).toEqual([{ sourcePath: join(root, 'src/B.tsx') }]);
    });

    it('reads a shard an older version wrote, and replaces it once the source is seen again', () => {
        // Format 1 carried no sites. Its classes still reach the safelist; the
        // next write for the same source is not skipped as equivalent, so the
        // sites arrive with it.
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        const paths = resolveNextSafelistStatePaths(root);
        const sourcePath = join(root, 'src/A.tsx');
        writeFileSync(sourcePath, 'export {}');
        mkdirSync(paths.shardsDir, { recursive: true });
        const old = {
            version: 1,
            cacheKey: 'old',
            sourcePath,
            sourceHash: 'h',
            classes: ['p-8'],
            timestamp: 1,
            pid: 1,
        };
        writeFileSync(join(paths.shardsDir, 'old.json'), JSON.stringify(old));

        expect(materializeNextSafelist(paths, { retryDelayMs: 0 }).classes).toEqual(['p-8']);
        const input = {
            cacheKey: 'old',
            sourcePath,
            sourceHash: 'h',
            classes: ['p-8'],
            classSites: [SITE_P8],
        };
        expect(writeNextSafelistShard(paths.shardsDir, input).changed).toBe(true);
        expect(writeNextSafelistShard(paths.shardsDir, input).changed).toBe(false);
        expect(JSON.parse(readFileSync(join(paths.shardsDir, 'old.json'), 'utf8'))).toMatchObject({
            version: NEXT_SAFELIST_SHARD_FORMAT,
            classSites: [SITE_P8],
        });
    });

    it('writes a shard the 0.17.2 reader keeps, so a session of each loses no class', () => {
        // A field added beside the old ones breaks no reader: 0.17.2 reads the
        // fields it knows and drops the rest. Bumping the number for it made
        // that reader delete every shard this version wrote.
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        const paths = resolveNextSafelistStatePaths(root);
        const sourcePath = join(root, 'src/A.tsx');
        writeFileSync(sourcePath, 'export {}');
        const { filePath } = writeNextSafelistShard(paths.shardsDir, {
            sourcePath,
            sourceHash: 'h',
            classes: ['p-8'],
            authoredClasses: ['card'],
            mergeLiterals: ['p-8'],
            classSites: [SITE_P8],
        });

        const kept = readShardAs0172(JSON.parse(readFileSync(filePath, 'utf8')));
        expect(kept?.classes).toEqual(['p-8']);
    });

    it('is read by the reader of the same release', () => {
        expect(NEXT_SAFELIST_SHARD_FORMAT).toBe(NEXT_SAFELIST_SHARD_READ_FORMAT);
    });

    it('keeps a shard of a format it does not read on disk, uses none of it, and says how to rewrite it once', () => {
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        const paths = resolveNextSafelistStatePaths(root);
        const sourcePath = join(root, 'src/A.tsx');
        writeFileSync(sourcePath, 'export {}');
        mkdirSync(paths.shardsDir, { recursive: true });
        const shard = {
            version: 99,
            cacheKey: 'newer',
            sourcePath,
            sourceHash: 'h',
            classes: ['p-8'],
            timestamp: 1,
            pid: 1,
        };
        writeFileSync(join(paths.shardsDir, 'newer.json'), JSON.stringify(shard));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(materializeNextSafelist(paths, { retryDelayMs: 0 }).classes).toEqual([]);
        expect(materializeNextSafelist(paths, { retryDelayMs: 0 }).classes).toEqual([]);
        expect(existsSync(join(paths.shardsDir, 'newer.json'))).toBe(true);
        const lines = warn.mock.calls.map(call => String(call[0]));
        expect(lines).toEqual([
            // The line names the shard with `/` on every platform.
            `[csszyx] .csszyx/cache/safelist-shards/newer.json is a safelist shard in format 99, and this version reads format ${NEXT_SAFELIST_SHARD_READ_FORMAT}: its classes are left out of the safelist.\n` +
                '  help: run `csszyx next prebuild` with the csszyx this project installs, which writes every shard again.',
        ]);
        warn.mockRestore();
    });

    it('keeps a shard whose sites are not of the shape it writes, without the sites', () => {
        const root = tempRoot();
        mkdirSync(join(root, 'src'), { recursive: true });
        const paths = resolveNextSafelistStatePaths(root);
        const sourcePath = join(root, 'src/A.tsx');
        writeFileSync(sourcePath, 'export {}');
        mkdirSync(paths.shardsDir, { recursive: true });
        const shard = {
            version: NEXT_SAFELIST_SHARD_FORMAT,
            cacheKey: 'odd',
            sourcePath,
            sourceHash: 'h',
            classes: ['p-8'],
            timestamp: 1,
            pid: 1,
        };
        for (const [index, classSites] of [
            'p-8',
            [{ className: 'p-8', line: '3', column: 7, key: 'p' }],
            [null],
        ].entries()) {
            writeFileSync(
                join(paths.shardsDir, 'odd.json'),
                JSON.stringify({ ...shard, classSites, timestamp: index + 1 }),
            );
            expect(
                materializeNextSafelist(paths, { retryDelayMs: 0 }).classOrigins.get('p-8'),
            ).toEqual([{ sourcePath }]);
        }
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
                classes: ['p-8', 'bg-red-500', 'p-8', '[&_.tab-item-header]:py-0!'],
                timestamp: 1,
            },
            { retryDelayMs: 0 },
        );

        const result = materializeNextSafelist(paths, { retryDelayMs: 0 });

        expect(result).toEqual({
            classes: ['[&_.tab-item-header]:py-0!', 'bg-red-500', 'p-8'],
            authoredClasses: [],
            mergeLiterals: [],
            classOrigins: new Map([
                ['[&_.tab-item-header]:py-0!', [{ sourcePath }]],
                ['bg-red-500', [{ sourcePath }]],
                ['p-8', [{ sourcePath }]],
            ]),
            classCount: 3,
            sourceCount: 1,
            tombstonedSourceCount: 0,
            shardCount: 1,
            sourcePaths: [sourcePath],
        });
        expect(readFileSync(paths.outputPath, 'utf8')).toBe(
            `${SAFELIST_HEADER}[&_.tab-item-header]:py-0!\nbg-red-500\np-8\n`,
        );
        // The snapshot stores resolved OS-native paths, and JSON escapes
        // Windows backslashes to `\\`, so a raw substring match against the
        // single-backslash path is brittle (it fails on Windows). Decode the
        // snapshot and compare structured entries instead of raw bytes.
        const snapshot = JSON.parse(readFileSync(paths.snapshotPath, 'utf8')) as {
            sources: Array<[string, string[]]>;
        };
        expect(snapshot.sources.map(([entry]) => entry)).toContain(resolve(sourcePath));
    });

    /**
     * A project that still passes the pre-0.15.0 name through `--output-file`
     * or the loader's `safelistOutputFile` gets today's plain-text file at
     * that name. The legacy sweep that runs after the write must not mistake
     * that fresh output for a leftover and delete it.
     */
    it('keeps an output the author still names the old way', () => {
        const root = tempRoot();
        const sourcePath = join(root, 'src/App.tsx');
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(sourcePath, 'export function App() {}', { flag: 'wx' });
        const paths = resolveNextSafelistStatePaths(
            root,
            '.csszyx/cache',
            '.csszyx/next-loader-classes.html',
        );
        writeNextSafelistShard(
            paths.shardsDir,
            { sourcePath, sourceHash: 'hash-a', classes: ['p-8'], timestamp: 1 },
            { retryDelayMs: 0 },
        );

        materializeNextSafelist(paths, { retryDelayMs: 0 });

        expect(readFileSync(paths.outputPath, 'utf8')).toBe(`${SAFELIST_HEADER}p-8\n`);
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
        expect(readFileSync(paths.outputPath, 'utf8')).toBe(SAFELIST_HEADER);
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

    it('removes the temporary file after bounded rename retries are exhausted', () => {
        const root = tempRoot();
        const destination = join(root, 'nested', 'state.json');
        const locked = new Error('locked') as NodeJS.ErrnoException;
        locked.code = 'EBUSY';

        expect(() =>
            atomicWriteFileSync(destination, 'state', {
                maxRetries: 1,
                retryDelayMs: 1,
                renameSync: () => {
                    throw locked;
                },
            }),
        ).toThrow(locked);
        expect(existsSync(destination)).toBe(false);
        expect(
            existsSync(join(root, 'nested'))
                ? readdirSync(join(root, 'nested')).filter(name => name.startsWith('.tmp-'))
                : [],
        ).toEqual([]);
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

    it('treats a cross-host lock as live within the staleness window even if the local pid lookup would say otherwise', () => {
        const root = tempRoot();
        const lockPath = join(root, '.csszyx/cache/state.lock');
        mkdirSync(join(root, '.csszyx/cache'), { recursive: true });
        writeFileSync(
            lockPath,
            `${JSON.stringify(
                {
                    version: 1,
                    pid: 4242,
                    token: 'other-host-token',
                    hostname: 'remote-build-runner.example',
                    root,
                    mode: 'development',
                    command: 'csszyx next watch',
                    startedAt: '2026-06-04T00:00:00.000Z',
                    updatedAt: '2026-06-04T00:00:10.000Z',
                },
                null,
                2,
            )}\n`,
            'utf8',
        );

        // The local pid 4242 would resolve to "not alive" on the current host;
        // without the hostname guard the lock would be incorrectly stolen.
        expect(() =>
            acquireNextSafelistStateLock(lockPath, {
                pid: 999,
                root,
                hostname: 'this-host.local',
                now: Date.parse('2026-06-04T00:00:15.000Z'),
                staleAfterMs: 30_000,
                isProcessAlive: () => false,
            }),
        ).toThrow(/already locked/);
    });

    it('recovers a cross-host lock after staleAfterMs without consulting the local pid lookup', () => {
        const root = tempRoot();
        const lockPath = join(root, '.csszyx/cache/state.lock');
        mkdirSync(join(root, '.csszyx/cache'), { recursive: true });
        writeFileSync(
            lockPath,
            `${JSON.stringify(
                {
                    version: 1,
                    pid: 4242,
                    token: 'other-host-token',
                    hostname: 'remote-build-runner.example',
                    root,
                    mode: 'development',
                    command: 'csszyx next watch',
                    startedAt: '2026-06-04T00:00:00.000Z',
                    updatedAt: '2026-06-04T00:00:10.000Z',
                },
                null,
                2,
            )}\n`,
            'utf8',
        );

        const lock = acquireNextSafelistStateLock(lockPath, {
            pid: 9999,
            root,
            hostname: 'this-host.local',
            now: Date.parse('2026-06-04T00:01:00.000Z'),
            staleAfterMs: 30_000,
            // Liveness should not even be consulted on cross-host stale locks;
            // a thrown probe would fail the test if it was reached.
            isProcessAlive: () => {
                throw new Error('cross-host stale lock must not probe local pid');
            },
            token: 'recovered-token',
        });
        expect(readNextSafelistStateLockMetadata(lockPath)?.token).toBe('recovered-token');
        lock.release();
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
