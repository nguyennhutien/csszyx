/**
 * The ignore patterns of the Next commands, matched against paths under a root.
 *
 * The command line prunes its source watcher with them and the loader filters
 * its stylesheet walk with them. One matcher serves both: a second reading of
 * `legacy/**` would let a stylesheet vote on the Tailwind prefix in one lane
 * and not in the other.
 *
 * @module
 */
import path from 'node:path';

import { braceExpand, Minimatch } from 'minimatch';

/** Directory verdicts kept per matcher before the memo is dropped and refilled. */
const MAX_REMEMBERED_DIRECTORIES = 50_000;

/**
 * What the Next commands say about an ignore pattern that starts with `!`.
 *
 * @param pattern - The pattern as the user wrote it.
 * @returns The message.
 */
function negatedIgnorePatternMessage(pattern: string): string {
    return [
        `[csszyx] the ignore pattern \`${pattern}\` is negated, and an ignore list cannot take one: each pattern only adds paths to leave out.`,
        '  help: narrow the pattern that covers too much, so that nothing has to be taken back out.',
    ].join('\n');
}

/** The ignore list, asked about one path at a time. */
export interface RootIgnoreMatcher {
    /**
     * Whether the path and everything under it are left out, so a walker can
     * skip a directory without reading it. `legacy/*` matches the directory
     * `legacy/deep` and still keeps what is inside, so this answers false there.
     */
    coversTree(path: string): boolean;
    /** Whether a file is left out. */
    ignoresFile(file: string): boolean;
}

/** One pattern after brace expansion, compiled. */
interface CompiledPattern {
    matcher: Minimatch;
    /**
     * Whether a directory this pattern matches takes everything under it along.
     * fast-glob stops descending there only for a pattern that ends in `/**` or
     * whose last segment is static; `legacy/*` matches the directory
     * `legacy/deep` and still lets `legacy/deep/file` through.
     */
    coversBelow: boolean;
}

/**
 * Compile one ignore pattern the way the source glob reads it.
 *
 * @param pattern - The pattern as the user wrote it.
 * @returns One entry per brace expansion, plus the bare directory of a `dir/**`.
 * @throws {Error} When the pattern is negated.
 */
function compilePattern(pattern: string): CompiledPattern[] {
    if (pattern.startsWith('!')) throw new Error(negatedIgnorePatternMessage(pattern));
    const relative = pattern.startsWith('./') ? pattern.slice(2) : pattern;
    return braceExpand(relative).flatMap(expanded => {
        const options = { dot: true, nobrace: true };
        const compiled: CompiledPattern[] = [];
        const lastSegment = expanded.slice(expanded.lastIndexOf('/') + 1);
        const endsInGlobstar = expanded.endsWith('/**');
        compiled.push({
            matcher: new Minimatch(expanded, options),
            coversBelow: endsInGlobstar || !new Minimatch(lastSegment, options).hasMagic(),
        });
        // `legacy/**` does not match `legacy` itself, and a walker prunes at
        // the directory, before it has seen anything the pattern does match.
        if (endsInGlobstar) {
            compiled.push({
                matcher: new Minimatch(expanded.slice(0, -3), options),
                coversBelow: true,
            });
        }
        return compiled;
    });
}

/**
 * Build a predicate for the paths under a root that the patterns cover.
 *
 * It reads the list the way fast-glob reads `ignore`, because the Next commands
 * give the same list to both: fast-glob finds the sources, this prunes the
 * watcher and the stylesheet walk. Read differently, an app's sources are
 * skipped while its Tailwind entry still votes. A pattern covers a path it
 * matches, and everything under a directory it matches when it ends in `/**`
 * or its last segment is static. The CLI suite runs both over one tree.
 *
 * Files share their ancestors, so a directory's verdict is kept. A walk of `N`
 * files under `D` directories with `p` expanded patterns costs `O((N + D) * p)`
 * matches, and the string work is linear in the path. The worst case is a
 * pattern minimatch itself matches slowly, which only the user can write.
 *
 * @param root - The directory the patterns are relative to.
 * @param ignore - Glob patterns, relative to the root, with forward slashes.
 * @returns The two questions a caller asks; both answer false for the root
 * itself and for any path outside it.
 * @throws {Error} When a pattern is negated. Each pattern is matched on its own,
 * so `!keep.css` would match every path but that one.
 */
export function createRootIgnoreMatcher(
    root: string,
    ignore: readonly string[],
): RootIgnoreMatcher {
    const patterns = ignore.flatMap(compilePattern);
    if (patterns.length === 0) return { coversTree: () => false, ignoresFile: () => false };
    const covering = patterns.filter(pattern => pattern.coversBelow);
    const coveredDirectories = new Map<string, boolean>();

    const isCoveredDirectory = (directory: string): boolean => {
        const known = coveredDirectories.get(directory);
        if (known !== undefined) return known;
        const covered = covering.some(pattern => pattern.matcher.match(directory));
        // A watcher lives for the session and sees paths without end.
        if (coveredDirectories.size >= MAX_REMEMBERED_DIRECTORIES) coveredDirectories.clear();
        coveredDirectories.set(directory, covered);
        return covered;
    };

    /**
     * Whether a directory on the way to a path, the path itself included when
     * `inclusive`, is one a covering pattern matches.
     *
     * @param relative - The path relative to the root, with forward slashes.
     * @param inclusive - Whether the path itself is asked too.
     * @returns True when a covering pattern takes it along.
     */
    const coveredOnTheWay = (relative: string, inclusive: boolean): boolean => {
        let end = relative.indexOf('/');
        while (end !== -1) {
            if (isCoveredDirectory(relative.slice(0, end))) return true;
            end = relative.indexOf('/', end + 1);
        }
        return inclusive && isCoveredDirectory(relative);
    };

    return {
        coversTree: candidate => {
            const relative = relativeUnder(root, candidate);
            return relative !== null && coveredOnTheWay(relative, true);
        },
        ignoresFile: candidate => {
            const relative = relativeUnder(root, candidate);
            if (relative === null) return false;
            return (
                coveredOnTheWay(relative, false) ||
                patterns.some(pattern => pattern.matcher.match(relative))
            );
        },
    };
}

/**
 * A path relative to a root, with forward slashes.
 *
 * @param root - The directory the patterns are relative to.
 * @param candidate - The path to place.
 * @returns The relative path, or null for the root itself and anything outside it.
 */
function relativeUnder(root: string, candidate: string): string | null {
    const relative = path.relative(root, path.resolve(candidate)).replaceAll('\\', '/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return null;
    return relative;
}
