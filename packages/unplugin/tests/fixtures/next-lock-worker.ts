import { existsSync } from 'node:fs';

import { acquireNextSafelistStateLock } from '../../src/next-safelist-state.js';

const [lockPath, barrierPath, holdMsValue, staleAfterMsValue] = process.argv.slice(2);
if (!lockPath || !barrierPath) {
    throw new Error('Expected lockPath and barrierPath worker arguments.');
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
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMsValue ?? 1_000));
    lock.release();
    process.exitCode = 0;
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
}
