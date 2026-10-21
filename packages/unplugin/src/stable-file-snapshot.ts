import * as fs from 'node:fs';

import { diagnosticError } from './diagnostic-message.js';

const DEFAULT_MAX_ATTEMPTS = 3;

/** Text and metadata captured from one stable file version. */
export interface StableTextFileSnapshot {
    source: string;
    mtimeMs: number;
}

/** Filesystem operations used by the stable snapshot reader. */
export interface StableFileSnapshotFs {
    openSync(path: string, flags: string): number;
    fstatSync(fd: number, options: { bigint: true }): fs.BigIntStats;
    readFileSync(fd: number, encoding: 'utf8'): string;
    closeSync(fd: number): void;
}

const NODE_FS: StableFileSnapshotFs = {
    openSync: fs.openSync,
    fstatSync: (fd: number, options: { bigint: true }): fs.BigIntStats => fs.fstatSync(fd, options),
    readFileSync: (fd: number, encoding: 'utf8'): string => fs.readFileSync(fd, encoding),
    closeSync: fs.closeSync,
};

/**
 * Reads text and matching metadata from one descriptor version.
 *
 * A concurrent writer can change a file between metadata and content reads.
 * Retry when descriptor metadata changes so callers never cache content under
 * a timestamp from a different version.
 *
 * @param file Absolute source path.
 * @param maxAttempts Maximum stable-read attempts.
 * @param fsApi Filesystem implementation, injectable for deterministic tests.
 * @returns Stable source content and its matching modification time.
 * @throws {CsszyxError} `css-source-unstable` when every read raced a writer;
 *         `internal-error` for a `maxAttempts` that is not a positive integer.
 */
export function readStableTextFileSnapshotSync(
    file: string,
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
    fsApi: StableFileSnapshotFs = NODE_FS,
): StableTextFileSnapshot {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw diagnosticError('internal-error', {
            where: 'readStableTextFileSnapshotSync',
            detail: `maxAttempts is ${maxAttempts}, not a positive integer`,
        });
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const fd = fsApi.openSync(file, 'r');
        try {
            const before = fsApi.fstatSync(fd, { bigint: true });
            const source = fsApi.readFileSync(fd, 'utf8');
            const after = fsApi.fstatSync(fd, { bigint: true });
            if (isSameFileVersion(before, after)) {
                return { source, mtimeMs: Number(after.mtimeMs) };
            }
        } finally {
            fsApi.closeSync(fd);
        }
    }

    throw diagnosticError('css-source-unstable', {}, { at: file });
}

/**
 * Checks whether a descriptor remained on the same file version.
 *
 * @param before Metadata captured before reading.
 * @param after Metadata captured after reading.
 * @returns Whether both snapshots identify the same unchanged version.
 */
function isSameFileVersion(before: fs.BigIntStats, after: fs.BigIntStats): boolean {
    return (
        before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeNs === after.mtimeNs &&
        before.ctimeNs === after.ctimeNs
    );
}
