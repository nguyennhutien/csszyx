/**
 * The development lines `szcn` prints about its merge table, spelled out from
 * the registry's words so a suite pins the bytes the user reads.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import { runtimeMessage } from '../../../compiler/tests/engine-message.js';

/** `merge-table-missing`: two classes met with no table. */
export const MISSING_TABLE_LINE = runtimeMessage(
    'merge-table-missing',
    "`szcn` has no merge table in this run, so it removes only exact repeats: `szcn('p-2', 'p-4')` keeps both classes.",
    'help: use the csszyx plugin for Vite, Rollup, webpack or Next.js, which registers one; for jest, run the build or `csszyx next prebuild` first.',
    'note: esbuild, Rspack, Rsbuild, Rolldown, Farm and Bun ship no table.',
);

/**
 * `merge-table-format-skew`: a table in a format this runtime does not read.
 *
 * @param format - The format the table was written in.
 * @returns The line.
 */
export function formatSkewLine(format: number): string {
    return runtimeMessage(
        'merge-table-format-skew',
        `The merge table was written in format ${format}, and this runtime reads format 1, so \`szcn\` ignores the table and removes only exact repeats.`,
        'help: run the build, or `csszyx next prebuild` on Next.js, with the csszyx versions now installed.',
    );
}
