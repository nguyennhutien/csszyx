/**
 * Bounded concurrency for the stylesheet and source passes that share this
 * package: a loop that awaits each file in turn leaves the disk idle between
 * reads, and an unbounded `Promise.all` over a project's sources can hold more
 * files open than the process may.
 *
 * @module
 */

/** File reads overlap this far; well under any descriptor limit a process starts with. */
export const FILE_READ_CONCURRENCY = 16;

/** Two Tailwind compiles overlap without multiplying their peak memory unboundedly. */
export const STYLESHEET_COMPILE_CONCURRENCY = 2;

/**
 * Apply an asynchronous operation with a fixed worker count and ordered results.
 *
 * For N items and C workers this performs O(N) scheduling work, retains O(N + C)
 * state, and shortens the independent I/O/compile critical path toward O(N / C).
 * A caller compiling stylesheets keeps C small, because each Tailwind compile
 * holds a large transient state; a caller reading files can afford more.
 *
 * @param items - Values to process in their caller-provided order.
 * @param concurrency - Maximum operations allowed to overlap.
 * @param operation - Independent asynchronous work for one value.
 * @returns Results in the same order as `items`, regardless of completion order.
 */
export async function mapConcurrent<T, U>(
    items: readonly T[],
    concurrency: number,
    operation: (item: T) => Promise<U>,
): Promise<U[]> {
    const results = new Array<U>(items.length);
    let nextIndex = 0;
    // Each worker takes the next item when its last one settles, so at most
    // `concurrency` operations are in flight.
    const worker = async (): Promise<void> => {
        if (nextIndex >= items.length) return;
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(items[index] as T);
        return worker();
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}
