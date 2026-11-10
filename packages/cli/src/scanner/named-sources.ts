/**
 * Which sources a command reads when it is not told: what git keeps, plus what
 * a stylesheet's `@source` names (ADR 0033).
 *
 * The build's prescan walks the project the way Tailwind's automatic detection
 * does, leaving out whatever `.gitignore` covers, and takes back the files a
 * stylesheet's explicit rules name, as the project's own Scanner lists them.
 * `csszyx check` and the Next prebuild and watch read the same set, so a class
 * the build safelists is one they read, and the other way round.
 *
 * @module
 */
import path from 'node:path';

import {
    createGitignoreQuery,
    filesNamedBySources,
    type ScanSource,
} from '@csszyx/tailwind-oracle';
import { createRootIgnoreMatcher } from '@csszyx/unplugin/next-prebuild';

import { withPosixSeparators } from '../utils/posix-path.js';

/**
 * Leave out of a glob's matches the files `.gitignore` covers.
 *
 * For a command's own default glob: a glob the user passed names its files,
 * as an `@source` does, and keeps them.
 *
 * Cost: one `.gitignore` read per folder the matches sit in, kept for the
 * call; linear in the matches.
 *
 * @param root - Folder the glob ran under.
 * @param files - Absolute paths it matched.
 * @returns The files git keeps, in the given order.
 */
export function keptByGit(root: string, files: readonly string[]): string[] {
    const gitignored = createGitignoreQuery(root);
    return files.filter(file => !gitignored(file));
}

/** What decides whether a file a rule names is added. */
export interface NamedSourceOptions {
    /** Folder the command reads under; a named file outside it is left out. */
    root: string;
    /** Files the command already reads, with forward slashes. */
    have: ReadonlySet<string>;
    /** The command's ignore globs, relative to `root`; they win over a rule. */
    ignore: readonly string[];
    /** Script extensions the command lowers, with their dot. */
    extensions: ReadonlySet<string>;
    /** A further test of the caller's, such as leaving out a declaration file. */
    keep?: (file: string) => boolean;
}

/**
 * The files a project's explicit sources name that a command does not read
 * yet: each stylesheet's `@source` rules, as its own Scanner lists them.
 *
 * Cost: see `filesNamedBySources`; nothing when no stylesheet has an
 * explicit rule. Then linear in what the rules name.
 *
 * @param resolveFrom - The project root, where Tailwind resolves from and
 *        automatic detection starts.
 * @param rules - Each root stylesheet's Scanner sources.
 * @param options - What decides whether a named file is added.
 * @returns Absolute paths with forward slashes, sorted; empty when none,
 *          null when a stylesheet has an explicit rule and the project has no
 *          Scanner to list it.
 */
export function namedSourcesToAdd(
    resolveFrom: string,
    rules: ReadonlyArray<readonly ScanSource[]>,
    options: NamedSourceOptions,
): string[] | null {
    const named = filesNamedBySources(resolveFrom, resolveFrom, rules);
    if (named === null || named.length === 0) return named;
    const matcher = createRootIgnoreMatcher(options.root, options.ignore);
    return named
        .map(withPosixSeparators)
        .filter(
            file =>
                options.extensions.has(path.extname(file)) &&
                !options.have.has(file) &&
                isInside(options.root, file) &&
                !matcher.ignoresFile(file) &&
                (options.keep?.(file) ?? true),
        );
}

/**
 * Whether a file sits under a folder.
 *
 * @param root - The folder.
 * @param file - Absolute path.
 * @returns True when it is inside.
 */
function isInside(root: string, file: string): boolean {
    const relative = path.relative(root, file);
    return (
        relative !== '' &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}
