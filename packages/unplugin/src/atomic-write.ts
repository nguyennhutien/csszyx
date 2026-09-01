import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Replace a file in one step, on every lane.
 *
 * Two properties, and both matter to a different lane:
 *
 * A rename REPLACES the path. `writeFileSync` opens it and overwrites whatever
 * it finds, which for a symlink is the file at the far end — anything able to
 * leave a link at a generated file's path redirects the next build into a file
 * nobody offered.
 *
 * A rename is also ATOMIC. A process killed part-way through a plain write
 * leaves a truncated file that its reader accepts as complete; here the reader
 * sees the old file or the new one and never half of either. The Next lane
 * needs this because several processes write the same directory; the Vite lane
 * needs it because a dev server is killed with Ctrl-C all day long.
 *
 * What lives here is only that: how to replace one file. Deciding WHO may write
 * — the shards and the lock the Next lane coordinates with — stays with that
 * lane, because a mutex guarding a file only one process touches costs latency
 * and buys nothing.
 */

const DEFAULT_RENAME_RETRIES = 5;
const DEFAULT_RENAME_RETRY_DELAY_MS = 10;

/** Options for atomic file writes that need to survive Windows file scanners. */
export interface AtomicWriteOptions {
    maxRetries?: number;
    retryDelayMs?: number;
    renameSync?: (from: string, to: string) => void;
}

/**
 * Whether a failed rename is one worth trying again.
 *
 * A virus scanner or an editor holding the destination open answers `EBUSY`,
 * `EPERM` or `EACCES` on Windows and releases it milliseconds later.
 *
 * @param error Whatever the rename threw.
 * @returns True when a retry is worth taking.
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
 * Block the thread without a timer, so a synchronous writer can wait.
 *
 * @param ms Milliseconds to wait.
 */
function sleepSync(ms: number): void {
    if (ms <= 0) {
        return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
 * Write a file by renaming a temporary one over its path.
 *
 * The temporary file is created in the DESTINATION's directory, because a
 * rename across filesystems is not atomic and the system temp directory is
 * often a different one.
 *
 * @param file Destination path.
 * @param content Bytes to write.
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
        `.tmp-${path.basename(file)}-${process.pid}-${Date.now()}-${randomUUID()}`,
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
