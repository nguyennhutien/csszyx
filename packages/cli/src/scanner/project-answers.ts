/**
 * One project's Tailwind, asked about the classes a single conversion left to
 * migrate's tables, and about the prefix its classes carry. Its own module so
 * its declaration names only plain types: the verdict machinery types reach
 * the check pass, which the library entry's declarations do not carry.
 *
 * @module
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { MigrateRustTableVerdict } from '@csszyx/compiler/migrate';

import { createMigrateVerdicts, openCheckOracles } from './migrate-verdicts.js';

/**
 * What {@link projectPrefix} reads from the compiled stylesheets: the prefix
 * each sets, and why any did not compile. Spelled out rather than imported,
 * so this module's declaration names no type from the check pass.
 */
export type OpenPrefixOracles = (cwd: string) => Promise<{
    prefixes: ReadonlyArray<{ entry: string; prefix: string | null }>;
    skipped: readonly string[];
    hadEntries: boolean;
}>;

/** The prefix a project's classes carry. */
export interface ProjectPrefix {
    /** The prefix to read classes with, or null for none. */
    prefix: string | null;
    /** Why the stylesheets gave no prefix to read with, or null when they did. */
    unread: string | null;
}

/** Per project root: what the prefix was read from, and what it read. */
const prefixes = new Map<string, { key: string; read: ProjectPrefix }>();

/**
 * The Tailwind prefix a project's stylesheets set (`prefix(tw)`), as
 * `csszyx check` settles it. Under it, `tw:p-4` is the class and `p-4` is not
 * one.
 *
 * Only the answer is kept between calls, keyed by each stylesheet's and the
 * config's path and change time, so a long-lived caller compiles again when
 * one changes and holds no compiled design system meanwhile. Measured
 * 2026-10-28 on three project roots: finding and stat-ing the stylesheets
 * costs 1.5-30 ms a call, compiling them 71-168 ms and 14-61 MB. An answer
 * with a stylesheet that did not compile is not kept: installing Tailwind or
 * fixing an imported partial changes no entry.
 *
 * @internal Used by `csszyx migrate`; not a stable API.
 * @param cwd - Project root, where Tailwind and the stylesheets resolve.
 * @param open - How the stylesheets are compiled; the check pass by default.
 * @returns The prefix, and why there is none to trust when the stylesheets
 *   disagree or none compiled.
 */
export async function projectPrefix(
    cwd: string,
    open: OpenPrefixOracles = openCheckOracles,
): Promise<ProjectPrefix> {
    // The check pass is the one place that finds the entries; loaded on use,
    // as `openCheckOracles` loads it.
    const { projectPrefixStamp, settledPrefix } = await import('../commands/check.js');
    const key = await projectPrefixStamp(cwd);
    const known = prefixes.get(cwd);
    if (known?.key === key) return known.read;
    const opened = await open(cwd);
    const read = await settledPrefix(cwd, opened);
    if (opened.skipped.length === 0) prefixes.set(cwd, { key, read });
    else prefixes.delete(cwd);
    return read;
}

/** One project's Tailwind, for one conversion. */
export interface ProjectAnswers {
    /** The prefix the project's classes carry. */
    prefix(): Promise<ProjectPrefix>;
    /**
     * Ask about the classes a conversion left to migrate's tables.
     *
     * @param verdicts - What the tables decided, unasked.
     * @returns The answers to convert again with, or null when every answer
     *   agrees with its table; and why Tailwind could not be asked, or null.
     */
    ask(verdicts: readonly MigrateRustTableVerdict[] | undefined): Promise<{
        served: ReadonlyMap<string, boolean> | null;
        skipped: string | null;
    }>;
}

/**
 * One project's Tailwind, asked as `csszyx migrate` asks it for a file.
 *
 * The stylesheets compile at most once for both questions, and the compiled
 * design system goes with the returned object. A directory without a
 * `package.json` is not read at all: finding the stylesheets walks the whole
 * tree, which from a home directory takes minutes, on the thread that
 * answers every other call.
 *
 * @internal Used by `@csszyx/mcp-server`, which pins this package's exact
 * version; not a stable API.
 * @param cwd - Project root, where Tailwind and the stylesheets resolve.
 * @returns The two questions.
 */
export function projectAnswers(cwd: string): ProjectAnswers {
    if (!existsSync(path.join(cwd, 'package.json'))) {
        const unread = `${cwd} has no package.json, so no stylesheet was read`;
        return {
            prefix: () => Promise.resolve({ prefix: null, unread }),
            ask: verdicts =>
                Promise.resolve({ served: null, skipped: verdicts?.length ? unread : null }),
        };
    }
    let opened: ReturnType<typeof openCheckOracles> | undefined;
    const open = (root: string): ReturnType<typeof openCheckOracles> =>
        (opened ??= openCheckOracles(root));
    const project = createMigrateVerdicts(cwd, open);
    return {
        prefix: () => projectPrefix(cwd, open),
        ask: async verdicts => ({
            served: (await project.settle(verdicts)) ? project.answers : null,
            skipped: project.skipped(),
        }),
    };
}
