/** Compact, app-scoped merge data emitted by the build plugin. */
export type MergeSignatureTable = readonly [
    signatures: Readonly<Record<string, number>>,
    coverage: ReadonlyArray<readonly number[]>,
];

/**
 * The table format this runtime reads.
 *
 * The build writes the format it produced beside the table. The two are
 * separate numbers on purpose: a runtime and a plugin from different releases
 * can meet in one install, and a table the runtime would misread must be
 * refused rather than merged on. Change it only with the table's shape, and
 * the plugin's `MERGE_TABLE_FORMAT` with it.
 */
export const MERGE_TABLE_FORMAT = 1;

let table: MergeSignatureTable | undefined;
let generation = 0;

/** Whether the format warning has been printed this session. */
let warnedFormat = false;

/**
 * Replace the merge data for the current application build.
 *
 * A table the build wrote in another format is refused: `szcn` then keeps
 * every class, as it does with no table, and a warning says how to rebuild
 * it. `.csszyx/merge-registration.*` outlives an upgrade, so this is the
 * stale file a jest run meets first.
 *
 * @param next - Compact signature and coverage data emitted by the build.
 * @param options - What the build says about the table.
 * @param options.format - The format it was written in; omitted by a hand
 *        registration, which is read as this runtime's own.
 * @internal Called by generated code, not written by hand. The three
 * engines share these names as an ABI: a changed shape makes classes
 * vanish where a build and a runtime differ in version, so a new shape
 * gets a new name.
 */
export function registerMergeSignatures(
    next: MergeSignatureTable,
    options: { format?: number } = {},
): void {
    const { format } = options;
    generation += 1;
    if (format !== undefined && format !== MERGE_TABLE_FORMAT) {
        table = undefined;
        if (!warnedFormat) {
            warnedFormat = true;
            console.warn(
                `[csszyx] the merge table was written in format ${format} and this runtime reads ` +
                    `format ${MERGE_TABLE_FORMAT}, so \`szcn\` keeps every class until it is rebuilt.\n` +
                    '  help: run the build, or `csszyx next prebuild` on Next.js, with the csszyx ' +
                    'versions now installed.',
            );
        }
        return;
    }
    table = next;
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
