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
    holdMs = 1_000,
    staleAfterMs = 2_000,
): WorkerHandle {
    const child = spawn(
        process.execPath,
        [
            '--import',
            'tsx',
            workerPath,
            lockPath,
            barrierPath,
            String(holdMs),
            String(staleAfterMs),
        ],
        {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    let stdout = '';
    let stderr = '';
    let readyResolved = false;
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>(resolve => {
        resolveReady = resolve;
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
        stdout += chunk;
        if (!readyResolved && stdout.includes('ready\n')) {
            readyResolved = true;
            resolveReady();
        }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
        stderr += chunk;
    });

    return {
        ready,
        result: new Promise(resolve => {
            child.on('close', code => {
                resolve({ code, stdout, stderr });
            });
        }),
    };
}

describe('Next safelist advisory lock across processes', () => {
    it('allows exactly one process to recover a stale lock', async () => {
        const root = tempRoot();
        const lockPath = join(root, '.csszyx/cache/state.lock');
        const advisoryPath = `${lockPath}.lock`;
        const barrierPath = join(root, 'start-workers');
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

        const workers = Array.from({ length: 12 }, () => spawnWorker(lockPath, barrierPath));
        await Promise.all(workers.map(worker => worker.ready));
        writeFileSync(barrierPath, 'go\n', 'utf8');
        const results = await Promise.all(workers.map(worker => worker.result));

        const winners = results.filter(result => result.stdout.includes('acquired:'));
        const locked = results.filter(
            result => result.code === 2 && result.stderr.includes('already locked'),
        );
        expect(winners).toHaveLength(1);
        expect(winners[0]?.code).toBe(0);
        expect(locked).toHaveLength(11);
        expect(existsSync(lockPath)).toBe(false);
        expect(existsSync(advisoryPath)).toBe(false);
    }, 15_000);

    it('keeps a live owner exclusive against concurrent contenders', async () => {
        const root = tempRoot();
        const lockPath = join(root, '.csszyx/cache/state.lock');
        const ownerBarrier = join(root, 'start-owner');
        const contenderBarrier = join(root, 'start-contenders');
        mkdirSync(dirname(lockPath), { recursive: true });

        const owner = spawnWorker(lockPath, ownerBarrier, 1_500);
        await owner.ready;
        writeFileSync(ownerBarrier, 'go\n', 'utf8');
        await waitFor(() => existsSync(lockPath));

        const contenders = Array.from({ length: 8 }, () =>
            spawnWorker(lockPath, contenderBarrier, 10),
        );
        await Promise.all(contenders.map(worker => worker.ready));
        writeFileSync(contenderBarrier, 'go\n', 'utf8');
        const contenderResults = await Promise.all(contenders.map(worker => worker.result));
        const ownerResult = await owner.result;

        expect(ownerResult.code).toBe(0);
        expect(ownerResult.stdout).toContain('acquired:');
        expect(
            contenderResults.every(
                result => result.code === 2 && result.stderr.includes('already locked'),
            ),
        ).toBe(true);
    }, 15_000);
});

async function waitFor(assertion: () => boolean, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (assertion()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for process lock state.');
}
