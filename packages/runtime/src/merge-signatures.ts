/** Compact, app-scoped merge data emitted by the build plugin. */
export type MergeSignatureTable = readonly [
    signatures: Readonly<Record<string, number>>,
    coverage: ReadonlyArray<readonly number[]>,
];

let table: MergeSignatureTable | undefined;
let generation = 0;

/**
 * Replace the merge data for the current application build.
 * @param next - Compact signature and coverage data emitted by the build.
 */
export function registerMergeSignatures(next: MergeSignatureTable): void {
    table = next;
    generation += 1;
}

/**
 * Read the registered merge data without allocating.
 * @returns Current app-scoped table, or undefined before registration.
 */
export function getMergeSignatureTable(): MergeSignatureTable | undefined {
    return table;
}

/**
 * Generation used to invalidate the szcn memo after a dev rebuild.
 * @returns Monotonic registration generation.
 */
export function getMergeSignatureGeneration(): number {
    return generation;
}

/**
 * Test-only reset for suites that exercise the standalone legacy fallback.
 * @returns Nothing.
 */
export function __resetMergeSignaturesForTests(): void {
    table = undefined;
    generation += 1;
}
