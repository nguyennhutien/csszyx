/**
 * Comparing a path a watcher reports with a path a session recorded.
 *
 * On a file system that folds case — macOS and Windows by default — one file
 * has many spellings, and a watcher may report it in another one than the
 * root was read in (`C:\Projects\app` against `c:\projects\app`). An exact
 * comparison then misses the edit. Whether a directory folds case is asked of
 * the file system, never assumed from the platform: a case-sensitive APFS
 * volume and a Linux mount of a Windows drive both exist, and folding where
 * the file system keeps case would read two files as one.
 *
 * @module
 */
import { statSync } from 'node:fs';
import path from 'node:path';

/** What tells two directory entries apart. */
export interface PathIdentity {
    dev: number;
    ino: number;
}

/** Reads a path's identity; undefined when nothing is there. */
export type PathIdentityReader = (file: string) => PathIdentity | undefined;

/**
 * The identity of a path on disk.
 *
 * @param file - Absolute path.
 * @returns Its device and inode, or undefined when nothing is there.
 */
const statIdentity: PathIdentityReader = file => statSync(file, { throwIfNoEntry: false });

/** Each directory's answer, asked once. */
const folding = new Map<string, boolean>();

/**
 * A name with the case of every letter swapped.
 *
 * @param name - A path segment.
 * @returns The segment, each letter in the other case.
 */
function swapCase(name: string): string {
    let swapped = '';
    for (const char of name) {
        const upper = char.toUpperCase();
        swapped += char === upper ? char.toLowerCase() : upper;
    }
    return swapped;
}

/**
 * Ask the file system whether it folds case where a directory lives: the
 * nearest entry of the path whose name has a letter is looked up in the
 * other case, and the two spellings name one file only on a file system
 * that folds case.
 *
 * @param dir - Absolute path.
 * @param stat - How a path is looked up.
 * @returns True when another spelling names the same entry.
 */
function detectFolding(dir: string, stat: PathIdentityReader): boolean {
    let current = dir;
    for (;;) {
        const name = path.basename(current);
        const swapped = swapCase(name);
        const parent = path.dirname(current);
        if (swapped !== name) {
            const written = stat(current);
            const other = stat(path.join(parent, swapped));
            return written !== undefined && other?.dev === written.dev && other.ino === written.ino;
        }
        // No entry with a letter up to the root: nothing to fold.
        if (parent === current) return false;
        current = parent;
    }
}

/**
 * Whether the file system a directory lives on folds case.
 *
 * Asked once per directory; the first answer is kept for the process.
 *
 * @param dir - The directory, a project root as a rule.
 * @param options - How to ask.
 * @param options.stat - Looks a path up, in place of the file system: what is
 *        asked is then answered again and kept.
 * @returns True when two spellings of one path name the same file there.
 */
export function foldsCase(dir: string, options: { stat?: PathIdentityReader } = {}): boolean {
    const resolved = path.resolve(dir);
    const known = folding.get(resolved);
    if (known !== undefined && options.stat === undefined) return known;
    const answer = detectFolding(resolved, options.stat ?? statIdentity);
    folding.set(resolved, answer);
    return answer;
}

/**
 * Whether two paths under a project name the same file, by the rule of the
 * file system the project lives on.
 *
 * @param root - The project root, whose file system is asked.
 * @param left - An absolute path.
 * @param right - An absolute path.
 * @returns True when they are one file's spellings.
 */
export function samePath(root: string, left: string, right: string): boolean {
    const a = path.resolve(left);
    const b = path.resolve(right);
    return a === b || (foldsCase(root) && a.toLowerCase() === b.toLowerCase());
}

/**
 * A path relative to the project root, `/`-separated, read by the rule of the
 * file system the project lives on: a file under the root in another spelling
 * is still under it.
 *
 * @param root - The project root.
 * @param file - An absolute path.
 * @returns The relative path.
 */
export function projectRelative(root: string, file: string): string {
    const base = path.resolve(root);
    const target = path.resolve(file);
    const prefix = base.endsWith(path.sep) ? base : base + path.sep;
    const under =
        !target.startsWith(prefix) &&
        foldsCase(root) &&
        target.toLowerCase().startsWith(prefix.toLowerCase());
    const relative = under ? target.slice(prefix.length) : path.relative(base, target);
    return relative.split(path.sep).join('/');
}
