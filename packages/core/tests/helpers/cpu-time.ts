/**
 * The clock for a test that times code: CPU time this thread has spent.
 *
 * Wall time also counts the time other processes hold the CPU, so under a
 * full `pnpm verify:ci` on the host, with tests of every package running at
 * once, a check that passes alone reads far over its bound: a ratio that
 * reads ×16 alone read ×22 to ×25 by the clock and ×16 in CPU time under 14
 * busy processes, and `walkJsTokens` read ×34.8 against ×8. A cost or
 * linearity check reads this clock instead.
 *
 * The clock is coarse on a Linux runner: a thread's CPU time moves in steps,
 * so a read of a few milliseconds measured 0 on GitHub's runners and a ratio
 * read `Infinity`. A ratio check times each sample with {@link cpuMsPerCall}.
 *
 * @module
 */

/**
 * CPU time this thread has spent, in milliseconds: `process.threadCpuUsage`
 * where Node has it, the whole process's otherwise (vitest runs each test
 * file in a process of its own).
 *
 * @returns Milliseconds.
 */
export function cpuMs(): number {
    const { user, system } =
        typeof process.threadCpuUsage === 'function'
            ? process.threadCpuUsage()
            : process.cpuUsage();
    return (user + system) / 1000;
}

/** The CPU time one sample of {@link cpuMsPerCall} lasts at least. */
const SAMPLE_FLOOR_MS = 30;

/** The most calls one sample makes, so a clock that never moves cannot hang a test. */
const SAMPLE_MAX_CALLS = 10_000;

/**
 * CPU time one call of `call` takes, in milliseconds: it is called again
 * until a sample lasts {@link SAMPLE_FLOOR_MS}, and the sample is shared out,
 * so a call shorter than the clock's step still reads as a time rather
 * than 0.
 *
 * @param call - The code to time.
 * @returns Milliseconds per call.
 */
export function cpuMsPerCall(call: () => unknown): number {
    const start = cpuMs();
    let calls = 0;
    let elapsed: number;
    do {
        call();
        calls++;
        elapsed = cpuMs() - start;
    } while (elapsed < SAMPLE_FLOOR_MS && calls < SAMPLE_MAX_CALLS);
    return elapsed / calls;
}
