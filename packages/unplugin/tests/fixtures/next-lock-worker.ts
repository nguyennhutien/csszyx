import { existsSync } from 'node:fs';

import { acquireNextSafelistStateLock } from '../../src/next-safelist-state.js';

const [lockPath, barrierPath, releasePath, staleAfterMsValue] = process.argv.slice(2);
if (!lockPath || !barrierPath || !releasePath) {
    throw new Error('Expected lockPath, barrierPath, and releasePath worker arguments.');
}

process.stdout.write('ready\n');
while (!existsSync(barrierPath)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
}

try {
    const lock = acquireNextSafelistStateLock(lockPath, {
        root: process.cwd(),
        mode: 'development',
        command: 'next-lock-worker',
        staleAfterMs: Number(staleAfterMsValue ?? 2_000),
        token: `worker-${process.pid}`,
    });
    process.stdout.write(`acquired:${process.pid}\n`);
    while (!existsSync(releasePath)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    lock.release();
    process.exitCode = 0;
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
}
