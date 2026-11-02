import * as fs from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        rmdirSync: vi.fn(actual.rmdirSync),
        statSync: vi.fn(actual.statSync),
    };
});
vi.mock('proper-lockfile', () => ({ default: { lockSync: vi.fn() } }));
vi.mock('../src/atomic-write.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/atomic-write.js')>();
    return { ...actual, atomicWriteFileSync: vi.fn(actual.atomicWriteFileSync) };
});

import { atomicWriteFileSync } from '../src/atomic-write.js';
import {
    acquireNextSafelistStateLock,
    readNextSafelistStateLockMetadata,
} from '../src/next-safelist-state.js';

let root: string;
let path: string;
const release = vi.fn();
beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 'csszyx-lock-failures-'));
    path = join(root, 'state.lock');
    vi.mocked(lockfile.lockSync).mockReset().mockReturnValue(release);
    release.mockReset();
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.rmdirSync).mockReset();
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(atomicWriteFileSync).mockReset();
    fs.rmSync(root, { recursive: true, force: true });
});

function stale(directory: string): void {
    fs.mkdirSync(directory);
    fs.utimesSync(directory, new Date(0), new Date(0));
}

function metadata(pid: number, updatedAt = new Date().toISOString()): void {
    fs.writeFileSync(
        path,
        JSON.stringify({
            version: 1,
            pid,
            token: 'prior-owner',
            hostname: hostname(),
            root,
            mode: 'development',
            command: 'test',
            startedAt: updatedAt,
            updatedAt,
        }),
    );
}

describe('safelist lock failures', () => {
    it('uses current-process defaults and leaves missing metadata untouched on heartbeat', () => {
        const lock = acquireNextSafelistStateLock(path);
        expect(readNextSafelistStateLockMetadata(path)).toMatchObject({
            pid: process.pid,
            root: process.cwd(),
        });
        lock.heartbeat();
        expect(readNextSafelistStateLockMetadata(path)?.token).toBe(lock.token);
        fs.rmSync(path);
        lock.heartbeat();
        expect(fs.existsSync(path)).toBe(false);
        lock.release();
        expect(release).toHaveBeenCalledOnce();
    });

    it('supports the legacy numeric pid argument', () => {
        const lock = acquireNextSafelistStateLock(path, 12345);
        expect(readNextSafelistStateLockMetadata(path)?.pid).toBe(12345);
        lock.release();
    });

    it('preserves advisory-lock errors when no readable owner metadata exists', () => {
        const error = new Error('lock unavailable');
        vi.mocked(lockfile.lockSync).mockImplementationOnce(() => {
            throw error;
        });
        expect(() => acquireNextSafelistStateLock(path)).toThrow(error);
        expect(release).not.toHaveBeenCalled();
    });

    it('releases the advisory lock if writing owner metadata fails', () => {
        const error = new Error('disk full');
        vi.mocked(atomicWriteFileSync).mockImplementationOnce(() => {
            throw error;
        });
        expect(() => acquireNextSafelistStateLock(path)).toThrow(error);
        expect(release).toHaveBeenCalledOnce();
    });

    it('probes a live local owner when advisory state has disappeared', () => {
        metadata(process.pid);
        const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
        expect(() => acquireNextSafelistStateLock(path)).toThrow(
            expect.objectContaining({ code: 'next-safelist-locked' }),
        );
        expect(kill).toHaveBeenCalledWith(process.pid, 0);
        expect(release).toHaveBeenCalledOnce();
    });

    it('recovers a dead local owner even if its timestamp is malformed', () => {
        metadata(999999, 'invalid');
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
            throw new Error('ESRCH');
        });
        const lock = acquireNextSafelistStateLock(path);
        expect(kill).toHaveBeenCalledWith(999999, 0);
        expect(readNextSafelistStateLockMetadata(path)?.token).toBe(lock.token);
        lock.release();
    });

    it('reclaims a leaked stale recovery election', () => {
        stale(`${path}.lock`);
        stale(`${path}.recover`);
        const lock = acquireNextSafelistStateLock(path, { staleAfterMs: 1000 });
        expect(fs.existsSync(`${path}.lock`)).toBe(false);
        expect(fs.existsSync(`${path}.recover`)).toBe(false);
        lock.release();
    });

    it('leaves the advisory directory to an already elected recoverer', () => {
        stale(`${path}.lock`);
        fs.mkdirSync(`${path}.recover`);
        const lock = acquireNextSafelistStateLock(path, { staleAfterMs: 1000 });
        expect(fs.existsSync(`${path}.lock`)).toBe(true);
        expect(fs.existsSync(`${path}.recover`)).toBe(true);
        lock.release();
    });

    it('continues when another process reclaimed a stale election first', () => {
        stale(`${path}.lock`);
        stale(`${path}.recover`);
        vi.mocked(fs.rmdirSync).mockImplementationOnce(target => {
            fs.rmSync(target, { recursive: true });
            throw new Error('ENOENT');
        });
        const lock = acquireNextSafelistStateLock(path, { staleAfterMs: 1000 });
        expect(fs.existsSync(`${path}.lock`)).toBe(false);
        expect(fs.existsSync(`${path}.recover`)).toBe(false);
        lock.release();
    });

    it('does not remove an advisory directory that became fresh during election', () => {
        stale(`${path}.lock`);
        const actual = fs.statSync(`${path}.lock`);
        vi.mocked(fs.statSync)
            .mockReturnValueOnce(actual)
            .mockImplementationOnce(() => {
                throw new Error('ENOENT');
            })
            .mockReturnValueOnce({ ...actual, mtimeMs: Date.now() } as fs.Stats);
        const lock = acquireNextSafelistStateLock(path, { staleAfterMs: 1000 });
        expect(fs.existsSync(`${path}.lock`)).toBe(true);
        expect(fs.existsSync(`${path}.recover`)).toBe(false);
        lock.release();
    });

    it('releases the election after the stale advisory directory cannot be removed', () => {
        stale(`${path}.lock`);
        fs.writeFileSync(join(`${path}.lock`, 'foreign'), 'owned by another tool');
        const lock = acquireNextSafelistStateLock(path, { staleAfterMs: 1000 });
        expect(fs.existsSync(`${path}.lock`)).toBe(true);
        expect(fs.existsSync(`${path}.recover`)).toBe(false);
        lock.release();
    });

    it('tolerates a failed election release after reclaiming the stale advisory lock', () => {
        stale(`${path}.lock`);
        vi.mocked(fs.rmdirSync)
            .mockImplementationOnce(target => fs.rmSync(target, { recursive: true }))
            .mockImplementationOnce(() => {
                throw new Error('EPERM');
            });
        const lock = acquireNextSafelistStateLock(path, { staleAfterMs: 1000 });
        expect(fs.existsSync(`${path}.lock`)).toBe(false);
        expect(fs.existsSync(`${path}.recover`)).toBe(true);
        lock.release();
    });
});
