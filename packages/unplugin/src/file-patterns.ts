import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizePathSeparators } from './path-normalization.js';
import { sortStrings } from './sort.js';

/** File matcher accepted by csszyx plugin include/exclude options. */
export type FilePattern = string | RegExp;

const GLOB_MAGIC_RE = /[*?[\]{}]/;
const DEFAULT_IGNORED_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'build']);

/**
 * Normalizes file ids from Vite/Rollup/Webpack before matching.
 *
 * Bundlers often pass ids with query suffixes (`?import`, `?used`) and Windows
 * separators. Matching against the physical path keeps include/exclude behavior
 * predictable across adapters.
 *
 * @param id - Bundler file id or filesystem path.
 * @returns Normalized path without query/hash suffix.
 */
export function normalizeFileId(id: string): string {
    return normalizePathSeparators(id.split(/[?#]/, 1)[0]);
}

/**
 * Resolves and normalizes a root directory for path-relative matching.
 *
 * @param rootDir - Project root directory.
 * @returns Absolute normalized root path.
 */
function normalizeRoot(rootDir: string): string {
    return normalizePathSeparators(path.resolve(rootDir));
}

/**
 * Checks if a string contains glob metacharacters.
 *
 * @param pattern - Candidate pattern.
 * @returns True when the pattern should be treated as a glob.
 */
function hasGlobMagic(pattern: string): boolean {
    return GLOB_MAGIC_RE.test(pattern);
}

/**
 * Escapes a single character for safe RegExp construction.
 *
 * @param ch - Character to escape.
 * @returns RegExp-safe character string.
 */
function escapeRegExp(ch: string): string {
    return /[|\\{}()[\]^$+?.]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * Converts the subset of glob syntax users need for config filters into a RegExp.
 * Supports `*`, `**`, and `?`; braces/extglobs are intentionally treated literally.
 *
 * @param pattern - Glob pattern.
 * @returns RegExp equivalent for the supported glob subset.
 */
export function globToRegExp(pattern: string): RegExp {
    const normalized = normalizePathSeparators(pattern);
    let out = '^';
    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (ch === '*') {
            if (normalized[i + 1] === '*') {
                out += '.*';
                i++;
            } else {
                out += '[^/]*';
            }
        } else if (ch === '?') {
            out += '[^/]';
        } else {
            out += escapeRegExp(ch);
        }
    }
    out += '$';
    return new RegExp(out);
}

/**
 * Returns a normalized relative path from rootDir to file.
 *
 * @param file - Absolute or relative file path.
 * @param rootDir - Project root directory.
 * @returns Path relative to rootDir.
 */
function relativeToRoot(file: string, rootDir: string): string {
    const root = normalizeRoot(rootDir);
    const normalizedFile = normalizeFileId(file);
    return normalizePathSeparators(path.posix.relative(root, normalizedFile));
}

/**
 * Tests a file id against a string/RegExp config pattern.
 *
 * @param id - Bundler file id or filesystem path.
 * @param pattern - String glob/literal or RegExp pattern.
 * @param rootDir - Project root directory for relative matching.
 * @returns True when the file matches the pattern.
 */
export function matchesPattern(id: string, pattern: FilePattern, rootDir: string): boolean {
    const file = normalizeFileId(id);
    const relative = relativeToRoot(file, rootDir);

    if (pattern instanceof RegExp) {
        pattern.lastIndex = 0;
        return pattern.test(file) || pattern.test(relative);
    }

    const normalizedPattern = normalizePathSeparators(pattern);
    if (hasGlobMagic(normalizedPattern)) {
        const re = globToRegExp(normalizedPattern);
        return re.test(file) || re.test(relative);
    }

    const absolutePattern = path.isAbsolute(normalizedPattern)
        ? normalizeFileId(normalizedPattern)
        : normalizeFileId(path.join(rootDir, normalizedPattern));
    return file === absolutePattern || relative === normalizedPattern;
}

/**
 * Tests a file id against an optional list of patterns.
 *
 * @param id - Bundler file id or filesystem path.
 * @param patterns - Optional pattern or pattern array.
 * @param rootDir - Project root directory for relative matching.
 * @returns True when at least one pattern matches.
 */
export function matchesAnyPattern(
    id: string,
    patterns: FilePattern | FilePattern[] | undefined,
    rootDir: string,
): boolean {
    if (!patterns) {
        return false;
    }
    const list = Array.isArray(patterns) ? patterns : [patterns];
    return list.some(pattern => matchesPattern(id, pattern, rootDir));
}

/**
 * Collect every non-hidden file below a directory.
 *
 * @param dir Directory to walk.
 * @param files Destination file set.
 */
function collectDirectoryFiles(dir: string, files: Set<string>): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!DEFAULT_IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                collectDirectoryFiles(full, files);
            }
        } else {
            files.add(path.resolve(full));
        }
    }
}

/**
 * Test whether a collected file is retained by any literal or glob pattern.
 *
 * @param file Absolute collected file path.
 * @param patterns Requested file patterns.
 * @param rootDir Project root directory.
 * @returns Whether the file matches at least one pattern.
 */
function isExpandedPatternMatch(file: string, patterns: string[], rootDir: string): boolean {
    return patterns.some(pattern => {
        if (hasGlobMagic(pattern)) {
            return matchesPattern(file, pattern, rootDir);
        }
        const resolved = path.isAbsolute(pattern) ? pattern : path.join(rootDir, pattern);
        return normalizeFileId(path.resolve(resolved)) === normalizeFileId(file);
    });
}

/**
 * Expands literal paths and simple globs to existing files under rootDir.
 *
 * @param rootDir - Project root directory.
 * @param patterns - Literal path, glob, or array of paths/globs.
 * @returns Sorted absolute file paths matching the patterns.
 */
export function expandFilePatterns(rootDir: string, patterns: string | string[]): string[] {
    const list = Array.isArray(patterns) ? patterns : [patterns];
    const files = new Set<string>();

    let needsWalk = false;
    for (const pattern of list) {
        const resolved = path.isAbsolute(pattern) ? pattern : path.join(rootDir, pattern);
        if (hasGlobMagic(pattern)) {
            needsWalk = true;
            continue;
        }
        if (fs.existsSync(resolved)) {
            files.add(path.resolve(resolved));
        }
    }

    if (needsWalk) {
        collectDirectoryFiles(rootDir, files);
        for (const file of Array.from(files)) {
            if (!isExpandedPatternMatch(file, list, rootDir)) {
                files.delete(file);
            }
        }
    }

    return sortStrings(files);
}
