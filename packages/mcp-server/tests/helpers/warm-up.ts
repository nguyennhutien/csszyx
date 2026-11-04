/**
 * The first call into the engine in a test process loads it: the native
 * binding or the wasm module, and the tables behind them. That costs about
 * 300 ms on a laptop and several seconds on a shared CI runner, and a file's
 * first test paid it inside the 5 s a test gets, so it timed out there while
 * every test after it took a millisecond. Every file whose tests reach the
 * engine warms it here.
 */
import { beforeAll } from 'vitest';

/** Room for the first engine load on a loaded runner. */
const WARM_UP_TIMEOUT_MS = 60_000;

/**
 * Run a file's tool once before its tests, so no test pays the engine's first
 * load.
 *
 * @param run - One cheap call through the tool the file tests.
 */
export function warmUp(run: () => Promise<unknown>): void {
    beforeAll(async () => {
        await run();
    }, WARM_UP_TIMEOUT_MS);
}
