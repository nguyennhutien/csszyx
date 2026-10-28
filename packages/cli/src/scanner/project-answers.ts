/**
 * One project's Tailwind, asked about the classes a single conversion left to
 * migrate's tables. Its own module so its declaration names only plain types:
 * the verdict machinery types reach the check pass, which the library entry's
 * declarations do not carry.
 *
 * @module
 */
import type { MigrateRustTableVerdict } from '@csszyx/compiler/migrate';

import { createMigrateVerdicts } from './migrate-verdicts.js';
/**
 * Ask one project's Tailwind about the classes a conversion left to migrate's
 * tables, as `csszyx migrate` asks for a file.
 *
 * Opens the project's stylesheets for this call only; see
 * {@link createMigrateVerdicts} for which are asked and when there is no
 * answer.
 *
 * @internal Used by `@csszyx/mcp-server`, which pins this package's exact
 * version; not a stable API.
 * @param cwd - Project root, where Tailwind and the stylesheets resolve.
 * @param verdicts - What the tables decided, unasked.
 * @returns The answers to convert again with, or null when every answer
 *   agrees with its table or there is no Tailwind v4 to ask.
 */
export async function askProjectTailwind(
    cwd: string,
    verdicts: readonly MigrateRustTableVerdict[] | undefined,
): Promise<ReadonlyMap<string, boolean> | null> {
    const project = createMigrateVerdicts(cwd);
    return (await project.settle(verdicts)) ? project.answers : null;
}
