import type { BigIntStats } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
    readStableTextFileSnapshotSync,
    type StableFileSnapshotFs,
} from '../src/stable-file-snapshot.js';

function stats(version: bigint): BigIntStats {
    return {
        dev: 1n,
        ino: 2n,
        size: version,
        mtimeNs: version,
        ctimeNs: version,
        mtimeMs: version,
    } as BigIntStats;
}

describe('stable file snapshot', () => {
    it('returns content and metadata from one stable descriptor version', () => {
        const fsApi: StableFileSnapshotFs = {
            openSync: vi.fn(() => 1),
            fstatSync: vi.fn(() => stats(4n)),
            readFileSync: vi.fn(() => 'body'),
            closeSync: vi.fn(),
        };

        expect(readStableTextFileSnapshotSync('/theme.css', 3, fsApi)).toEqual({
            source: 'body',
            mtimeMs: 4,
        });
        expect(fsApi.closeSync).toHaveBeenCalledOnce();
    });

    it('retries when metadata changes during a read', () => {
        const versions = [stats(1n), stats(2n), stats(3n), stats(3n)];
        const fsApi: StableFileSnapshotFs = {
            openSync: vi.fn(() => 1),
            fstatSync: vi.fn(() => versions.shift() ?? stats(3n)),
            readFileSync: vi.fn().mockReturnValueOnce('stale').mockReturnValueOnce('stable'),
            closeSync: vi.fn(),
        };

        expect(readStableTextFileSnapshotSync('/theme.css', 2, fsApi)).toEqual({
            source: 'stable',
            mtimeMs: 3,
        });
        expect(fsApi.openSync).toHaveBeenCalledTimes(2);
        expect(fsApi.closeSync).toHaveBeenCalledTimes(2);
    });

    it('fails closed when every read races a writer', () => {
        const versions = [stats(1n), stats(2n), stats(3n), stats(4n)];
        const fsApi: StableFileSnapshotFs = {
            openSync: vi.fn(() => 1),
            fstatSync: vi.fn(() => versions.shift() ?? stats(4n)),
            readFileSync: vi.fn(() => 'unstable'),
            closeSync: vi.fn(),
        };

        expect(() => readStableTextFileSnapshotSync('/theme.css', 2, fsApi)).toThrow(
            'CSS source changed while being read',
        );
        expect(fsApi.closeSync).toHaveBeenCalledTimes(2);
    });
});
