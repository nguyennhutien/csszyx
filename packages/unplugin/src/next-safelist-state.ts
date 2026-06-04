/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { hostname } from 'node:os';
import * as path from 'node:path';

const DEFAULT_RENAME_RETRIES = 5;
const DEFAULT_RENAME_RETRY_DELAY_MS = 10;
const DEFAULT_STALE_LOCK_MS = 30_000;

/** Complete class metadata for one transformed source file. */
export interface NextSafelistShardInput {
    sourcePath: string;
    sourceHash: string;
    classes: readonly string[];
    cacheKey?: string;
    timestamp?: number;
    pid?: number;
}

/** Files used by the Next Turbopack safelist state machine. */
export interface NextSafelistStatePaths {
    cacheDir: string;
    shardsDir: string;
    snapshotPath: string;
    outputPath: string;
}

/** Result returned after materializing shard records. */
export interface NextSafelistMaterializeResult {
    classCount: number;
    sourceCount: number;
    tombstonedSourceCount: number;
    shardCount: number;
}

/** Options for atomic file writes that need to survive Windows file scanners. */
export interface AtomicWriteOptions {
    maxRetries?: number;
    retryDelayMs?: number;
    renameSync?: (from: string, to: string) => void;
}

/** Active lock returned by `acquireNextSafelistStateLock`. */
export interface NextSafelistStateLock {
    lockPath: string;
    token: string;
    heartbeat: () => void;
    release: () => void;
}

/** Metadata stored in the Next safelist state lock file. */
export interface NextSafelistStateLockMetadata {
    version: 1;
    pid: number;
    token: string;
    hostname: string;
    root: string;
    mode: 'development' | 'production';
    command: string;
    startedAt: string;
    updatedAt: string;
}

/** Options used when acquiring a state lock. */
export interface NextSafelistStateLockOptions {
    pid?: number;
    root?: string;
    mode?: 'development' | 'production';
    command?: string;
    now?: number;
    staleAfterMs?: number;
    isProcessAlive?: (pid: number) => boolean;
    token?: string;
}

/**
 *
 */
interface SnapshotFile {
    version: 1;
    sources: Array<[string, string[]]>;
}

/**
 *
 */
interface ShardFile {
    version: 1;
    cacheKey: string;
    sourcePath: string;
    sourceHash: string;
    classes: string[];
    timestamp: number;
    pid: number;
}

/**
 *
 */
interface ShardRecord {
    filePath: string;
    data: ShardFile;
}

/**
 * Resolve the state files for a Next Turbopack safelist directory.
 *
 * @param rootDir Project root, normally the loader `rootContext`.
 * @param cacheDir User configured cache dir. Defaults to `.csszyx/cache`.
 * @param outputFile Safelist file consumed by Tailwind `@source`.
 * @returns Absolute state file paths.
 */
export function resolveNextSafelistStatePaths(
    rootDir: string,
    cacheDir = '.csszyx/cache',
    outputFile = 'csszyx-classes.html',
): NextSafelistStatePaths {
    const resolvedCacheDir = path.resolve(rootDir, cacheDir);
    return {
        cacheDir: resolvedCacheDir,
        shardsDir: path.join(resolvedCacheDir, 'safelist-shards'),
        snapshotPath: path.join(resolvedCacheDir, 'safelist.snapshot.json'),
        outputPath: path.resolve(rootDir, outputFile),
    };
}

/**
 * Write one source file's complete class set as an atomic metadata shard.
 *
 * @param shardsDir Directory containing safelist shard JSON files.
 * @param input Complete class metadata for one source file.
 * @param options Atomic write options.
 * @returns Absolute shard file path.
 */
export function writeNextSafelistShard(
    shardsDir: string,
    input: NextSafelistShardInput,
    options: AtomicWriteOptions = {},
): string {
    const shard = normalizeShardInput(input);
    const filePath = path.join(shardsDir, `${shard.cacheKey}.json`);
    atomicWriteFileSync(filePath, `${JSON.stringify(shard, null, 2)}\n`, options);
    return filePath;
}

/**
 * Materialize source shards into the canonical Tailwind `@source` file.
 *
 * @param paths Safelist state paths.
 * @param options Atomic write options.
 * @returns Materialization metrics for logs/tests.
 */
export function materializeNextSafelist(
    paths: NextSafelistStatePaths,
    options: AtomicWriteOptions = {},
): NextSafelistMaterializeResult {
    const recordsBySource = new Map<string, ShardRecord>();
    let tombstonedSourceCount = 0;

    for (const record of readShardRecords(paths.shardsDir)) {
        if (!fs.existsSync(record.data.sourcePath)) {
            fs.rmSync(record.filePath, { force: true });
            tombstonedSourceCount++;
            continue;
        }

        const previous = recordsBySource.get(record.data.sourcePath);
        if (!previous || record.data.timestamp >= previous.data.timestamp) {
            recordsBySource.set(record.data.sourcePath, record);
        }
    }

    const sortedSources = [...recordsBySource.values()]
        .map(({ data }) => [data.sourcePath, [...new Set(data.classes)].sort()] as const)
        .sort(([left], [right]) => left.localeCompare(right));
    const classNames = [...new Set(sortedSources.flatMap(([, classSet]) => classSet))].sort();

    const snapshot: SnapshotFile = {
        version: 1,
        sources: sortedSources.map(([sourcePath, classSet]) => [sourcePath, classSet]),
    };

    atomicWriteFileSync(paths.outputPath, renderTailwindSourceHtml(classNames), options);
    atomicWriteFileSync(paths.snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, options);

    return {
        classCount: classNames.length,
        sourceCount: sortedSources.length,
        tombstonedSourceCount,
        shardCount: recordsBySource.size,
    };
}

/**
 * Acquire a metadata-backed state lock and recover stale locks automatically.
 *
 * @param lockPath Lock file path.
 * @param pidOrOptions Current process id for legacy tests or lock options.
 * @returns Lock handle with an idempotent release function.
 */
export function acquireNextSafelistStateLock(
    lockPath: string,
    pidOrOptions: number | NextSafelistStateLockOptions = {},
): NextSafelistStateLock {
    const options: NextSafelistStateLockOptions =
        typeof pidOrOptions === 'number' ? { pid: pidOrOptions } : pidOrOptions;
    const metadata = createLockMetadata(options);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try {
        fs.writeFileSync(lockPath, `${JSON.stringify(metadata, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
        });
    } catch (error) {
        if (!isFileExistsError(error)) {
            throw error;
        }
        const existing = readLockMetadata(lockPath);
        if (existing && isLockLive(existing, options)) {
            throw new Error(formatLiveLockError(existing));
        }
        fs.writeFileSync(lockPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    }

    let released = false;
    const writeCurrentMetadata = (updatedAt: string): void => {
        fs.writeFileSync(
            lockPath,
            `${JSON.stringify({ ...metadata, updatedAt }, null, 2)}\n`,
            'utf8',
        );
    };

    return {
        lockPath,
        token: metadata.token,
        heartbeat: () => {
            if (!released && readLockMetadata(lockPath)?.token === metadata.token) {
                writeCurrentMetadata(new Date(options.now ?? Date.now()).toISOString());
            }
        },
        release: () => {
            if (released) {
                return;
            }
            released = true;
            try {
                if (readLockMetadata(lockPath)?.token === metadata.token) {
                    fs.rmSync(lockPath, { force: true });
                }
            } catch {
                // Lock release is best-effort during process teardown.
            }
        },
    };
}

/**
 * Read lock metadata from disk.
 *
 * @param lockPath Lock file path.
 * @returns Parsed lock metadata, or null for missing/legacy/corrupt locks.
 */
export function readNextSafelistStateLockMetadata(
    lockPath: string,
): NextSafelistStateLockMetadata | null {
    return readLockMetadata(lockPath);
}

/**
 * Write a file by temp-write plus rename, retrying transient Windows locks.
 *
 * @param file Destination file.
 * @param content File content.
 * @param options Retry and rename injection options.
 */
export function atomicWriteFileSync(
    file: string,
    content: string,
    options: AtomicWriteOptions = {},
): void {
    const dir = path.dirname(file);
    const tmp = path.join(
        dir,
        `.tmp-${path.basename(file)}-${process.pid}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, content, 'utf8');

    try {
        atomicRenameWithRetry(tmp, file, options);
    } catch (error) {
        try {
            fs.rmSync(tmp, { force: true });
        } catch {
            // Preserve the original write failure.
        }
        throw error;
    }
}

/**
 * Rename with bounded retry for transient `EBUSY`/`EPERM`/`EACCES` file locks.
 *
 * @param from Temporary path.
 * @param to Destination path.
 * @param options Retry and rename injection options.
 */
export function atomicRenameWithRetry(
    from: string,
    to: string,
    options: AtomicWriteOptions = {},
): void {
    const maxRetries = options.maxRetries ?? DEFAULT_RENAME_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RENAME_RETRY_DELAY_MS;
    const renameSync = options.renameSync ?? fs.renameSync;

    for (let attempt = 0; ; attempt++) {
        try {
            renameSync(from, to);
            return;
        } catch (error) {
            if (!isRetryableRenameError(error) || attempt >= maxRetries) {
                throw error;
            }
            sleepSync(retryDelayMs);
        }
    }
}

/**
 *
 * @param input
 */
function normalizeShardInput(input: NextSafelistShardInput): ShardFile {
    const sourcePath = path.resolve(input.sourcePath);
    const classes = [
        ...new Set(input.classes.map(className => className.trim()).filter(Boolean)),
    ].sort();
    const cacheKey =
        input.cacheKey ??
        createHash('sha256').update(sourcePath).update('\0').update(input.sourceHash).digest('hex');

    return {
        version: 1,
        cacheKey,
        sourcePath,
        sourceHash: input.sourceHash,
        classes,
        timestamp:
            input.timestamp !== undefined && Number.isFinite(input.timestamp)
                ? input.timestamp
                : Date.now(),
        pid: input.pid ?? process.pid,
    };
}

/**
 *
 * @param shardsDir
 */
function readShardRecords(shardsDir: string): ShardRecord[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(shardsDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const records: ShardRecord[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const filePath = path.join(shardsDir, entry.name);
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ShardFile>;
            const record = normalizeShardRecord(filePath, parsed);
            if (record) {
                records.push(record);
            } else {
                fs.rmSync(filePath, { force: true });
            }
        } catch {
            fs.rmSync(filePath, { force: true });
        }
    }
    return records;
}

/**
 *
 * @param filePath
 * @param data
 */
function normalizeShardRecord(filePath: string, data: Partial<ShardFile>): ShardRecord | null {
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

    return {
        filePath,
        data: normalizeShardInput({
            cacheKey: data.cacheKey,
            sourcePath: data.sourcePath,
            sourceHash: data.sourceHash,
            classes: data.classes,
            timestamp: data.timestamp,
            pid: data.pid,
        }),
    };
}

/**
 *
 * @param classNames
 */
function renderTailwindSourceHtml(classNames: readonly string[]): string {
    if (classNames.length === 0) {
        return '<!-- csszyx Next safelist: empty -->\n';
    }
    return `${classNames.map(className => `<div class="${escapeHtmlAttribute(className)}"></div>`).join('\n')}\n`;
}

/**
 *
 * @param value
 */
function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 *
 * @param options
 */
function createLockMetadata(options: NextSafelistStateLockOptions): NextSafelistStateLockMetadata {
    const now = new Date(options.now ?? Date.now()).toISOString();
    const pid = options.pid ?? process.pid;
    return {
        version: 1,
        pid,
        token:
            options.token ??
            createHash('sha256')
                .update(`${pid}\0${now}\0${Math.random().toString(36)}`)
                .digest('hex'),
        hostname: hostname(),
        root: path.resolve(options.root ?? process.cwd()),
        mode: options.mode ?? 'development',
        command: options.command ?? process.argv.join(' '),
        startedAt: now,
        updatedAt: now,
    };
}

/**
 *
 * @param lockPath
 */
function readLockMetadata(lockPath: string): NextSafelistStateLockMetadata | null {
    try {
        const parsed = JSON.parse(
            fs.readFileSync(lockPath, 'utf8'),
        ) as Partial<NextSafelistStateLockMetadata>;
        if (
            parsed.version !== 1 ||
            typeof parsed.pid !== 'number' ||
            typeof parsed.token !== 'string' ||
            typeof parsed.hostname !== 'string' ||
            typeof parsed.root !== 'string' ||
            (parsed.mode !== 'development' && parsed.mode !== 'production') ||
            typeof parsed.command !== 'string' ||
            typeof parsed.startedAt !== 'string' ||
            typeof parsed.updatedAt !== 'string'
        ) {
            return null;
        }
        return {
            version: 1,
            pid: parsed.pid,
            token: parsed.token,
            hostname: parsed.hostname,
            root: path.resolve(parsed.root),
            mode: parsed.mode,
            command: parsed.command,
            startedAt: parsed.startedAt,
            updatedAt: parsed.updatedAt,
        };
    } catch {
        return null;
    }
}

/**
 *
 * @param metadata
 * @param options
 */
function isLockLive(
    metadata: NextSafelistStateLockMetadata,
    options: NextSafelistStateLockOptions,
): boolean {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_LOCK_MS;
    const updatedAt = Date.parse(metadata.updatedAt);
    const now = options.now ?? Date.now();
    if (Number.isFinite(updatedAt) && now - updatedAt > staleAfterMs) {
        return false;
    }
    return (options.isProcessAlive ?? isProcessAlive)(metadata.pid);
}

/**
 *
 * @param pid
 */
function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 *
 * @param metadata
 */
function formatLiveLockError(metadata: NextSafelistStateLockMetadata): string {
    return [
        `csszyx Next safelist state is already locked by process ${metadata.pid}.`,
        `root=${metadata.root}`,
        `mode=${metadata.mode}`,
        `host=${metadata.hostname}`,
        `updatedAt=${metadata.updatedAt}`,
    ].join(' ');
}

/**
 *
 * @param error
 */
function isFileExistsError(error: unknown): boolean {
    return (
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
    );
}

/**
 *
 * @param error
 */
function isRetryableRenameError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')
    );
}

/**
 *
 * @param ms
 */
function sleepSync(ms: number): void {
    if (ms <= 0) {
        return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
