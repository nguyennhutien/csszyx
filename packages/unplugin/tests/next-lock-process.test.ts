import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
const workerPath = fileURLToPath(new URL('./fixtures/next-lock-worker.ts', import.meta.url));

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

interface WorkerResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

interface WorkerHandle {
    ready: Promise<void>;
    acquired: Promise<boolean>;
    result: Promise<WorkerResult>;
}

function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-next-lock-process-'));
    tempDirs.push(root);
    return root;
}

function spawnWorker(
    lockPath: string,
    barrierPath: string,
    releasePath: string,
    staleAfterMs = 2_000,
): WorkerHandle {
    const child = spawn(
        process.execPath,
        ['--import', 'tsx', workerPath, lockPath, barrierPath, releasePath, String(staleAfterMs)],
        {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    let stdout = '';
    let stderr = '';
    let readyResolved = false;
    let acquiredResolved = false;
    let resolveReady: () => void = () => {};
    let resolveAcquired: (value: boolean) => void = () => {};
    const ready = new Promise<void>(resolve => {
        resolveReady = resolve;
    });
    const acquired = new Promise<boolean>(resolve => {
        resolveAcquired = resolve;
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
        stdout += chunk;
        if (!readyResolved && stdout.includes('ready\n')) {
            readyResolved = true;
            resolveReady();
        }
        if (!acquiredResolved && stdout.includes('acquired:')) {
            acquiredResolved = true;
            resolveAcquired(true);
        }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
        stderr += chunk;
    });

    return {
        ready,
        acquired,
        result: new Promise(resolve => {
            child.on('close', code => {
                if (!acquiredResolved) {
                    acquiredResolved = true;
                    resolveAcquired(false);
                }
                resolve({ code, stdout, stderr });
            });
        }),
    };
}

// Each case spawns a handful of real Node processes (node --import tsx) that
// race for a filesystem advisory lock. Spawn + tsx-compile + barrier sync are
// wall-clock heavy and vary with CI load, so a fixed timeout can trip even
// though the lock logic is correct. Retry absorbs that timing flake, and the
// per-test timeout is generous relative to a warm local run (~1-2s).
describe('Next safelist advisory lock across processes', { retry: 2 }, () => {
    it('allows exactly one process to recover a stale lock', async () => {
        const root = tempRoot();
        const lockPath = join(root, '.csszyx/cache/state.lock');
        const advisoryPath = `${lockPath}.lock`;
        const barrierPath = join(root, 'start-workers');
        const releasePath = join(root, 'release-winner');
        mkdirSync(advisoryPath, { recursive: true });
        writeFileSync(
            lockPath,
            `${JSON.stringify({
                version: 1,
                pid: 2_147_483_647,
                token: 'dead-owner',
                hostname: 'stale-host',
                root,
                mode: 'development',
                command: 'stale-worker',
                startedAt: '2020-01-01T00:00:00.000Z',
                updatedAt: '2020-01-01T00:00:00.000Z',
            })}\n`,
            'utf8',
        );
        const staleTime = new Date(Date.now() - 10_000);
        utimesSync(advisoryPath, staleTime, staleTime);

        const workerCount = 6;
        const workers = Array.from({ length: workerCount }, () =>
            spawnWorker(lockPath, barrierPath, releasePath),
        );
        await Promise.all(workers.map(worker => worker.ready));
        writeFileSync(barrierPath, 'go\n', 'utf8');
        const acquisitions = await Promise.all(workers.map(worker => worker.acquired));
        try {
            expect(acquisitions.filter(Boolean)).toHaveLength(1);
        } finally {
            writeFileSync(releasePath, 'release\n', 'utf8');
        }
        const results = await Promise.all(workers.map(worker => worker.result));

        const winners = results.filter(result => result.stdout.includes('acquired:'));
        const locked = results.filter(
            result => result.code === 2 && result.stderr.includes('already locked'),
        );
        expect(winners).toHaveLength(1);
        expect(winners[0]?.code).toBe(0);
        expect(locked).toHaveLength(workerCount - 1);
        expect(existsSync(lockPath)).toBe(false);
        expect(existsSync(advisoryPath)).toBe(false);
    }, 45_000);

    it('keeps a live owner exclusive against concurrent contenders', async () => {
        const root = tempRoot();
        const lockPath = join(root, '.csszyx/cache/state.lock');
        const ownerBarrier = join(root, 'start-owner');
        const ownerRelease = join(root, 'release-owner');
        const contenderBarrier = join(root, 'start-contenders');
        const contenderRelease = join(root, 'release-contenders');
        mkdirSync(dirname(lockPath), { recursive: true });

        const owner = spawnWorker(lockPath, ownerBarrier, ownerRelease);
        await owner.ready;
        writeFileSync(ownerBarrier, 'go\n', 'utf8');
        await expect(owner.acquired).resolves.toBe(true);

        const contenderCount = 4;
        const contenders = Array.from({ length: contenderCount }, () =>
            spawnWorker(lockPath, contenderBarrier, contenderRelease),
        );
        await Promise.all(contenders.map(worker => worker.ready));
        writeFileSync(contenderBarrier, 'go\n', 'utf8');
        let contenderResults: WorkerResult[];
        try {
            await expect(Promise.all(contenders.map(worker => worker.acquired))).resolves.toEqual(
                Array.from({ length: contenderCount }, () => false),
            );
            contenderResults = await Promise.all(contenders.map(worker => worker.result));
        } finally {
            writeFileSync(ownerRelease, 'release\n', 'utf8');
        }
        const ownerResult = await owner.result;

        expect(ownerResult.code).toBe(0);
        expect(ownerResult.stdout).toContain('acquired:');
        expect(
            contenderResults.every(
                result => result.code === 2 && result.stderr.includes('already locked'),
            ),
        ).toBe(true);
    }, 45_000);
});
