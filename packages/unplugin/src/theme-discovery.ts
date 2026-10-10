/**
 * Project-wide `@theme` discovery.
 *
 * Two lanes need the same answer and must not each derive it: the bundler
 * plugin, which feeds the theme-groups virtual module, and the Next loader,
 * which has no whole-project prescan and writes a real registration file
 * instead. A second walk that skipped one directory would make `szcn` merge
 * differently depending on which bundler ran, which is exactly the class of
 * divergence the shared classifier exists to prevent.
 *
 * @module
 */
import { walkProjectStylesheets } from '@csszyx/tailwind-oracle';

import { createRootIgnoreMatcher } from './root-ignore-matcher.js';
import { mergeThemes, type ParsedTheme, parseThemeBlocks } from './theme-scanner.js';

/** What a project-wide scan found. */
export interface ThemeDiscovery {
    /** Merged tokens, or null when no stylesheet declared an `@theme` block. */
    theme: ParsedTheme | null;
    /** The stylesheets tokens came from, for watch/HMR wiring. */
    files: string[];
    /**
     * EVERY stylesheet the walk read, not only the ones with tokens.
     *
     * Watching just the token-carrying files would miss a plain stylesheet
     * that later gains an `@theme` block — the edit that most needs to be
     * noticed, because it adds tokens the merge groups do not have yet.
     */
    scanned: string[];
    /**
     * Every `.gitignore` the walk applied. A record of what the walk found
     * fingerprints them: an edit to one can add or drop a stylesheet.
     */
    gitignoreFiles: string[];
}

/**
 * Normalize a path for prefix comparison across platforms.
 *
 * @param value - Filesystem path.
 * @returns The path with POSIX separators and no trailing slash.
 */
function normalize(value: string): string {
    const posix = value.replaceAll('\\', '/');
    return posix.endsWith('/') ? posix.slice(0, -1) : posix;
}

/**
 * Walk a project for `@theme` blocks and merge what they declare.
 *
 * The walk skips dependencies, build output, generated reports, dot-folders
 * (which keeps it out of `.csszyx/`, where this discovery's own output goes)
 * and whatever `.gitignore` covers: a Rust `target/`, a coverage report, a
 * built Storybook or a gitignored `out/` carries a copy of the app's
 * stylesheets from an older build, which can set an older prefix and stop the
 * build over a file no app loads. A gitignored stylesheet another one imports
 * is read all the same.
 *
 * @param rootDir - Project root to walk.
 * @param extraDirs - Directories outside the root to include as well; ones
 * already inside the root are skipped so their files are not read twice.
 * @param ignore - Glob patterns, relative to the root, for paths whose
 * stylesheets are another app's and are left out. A directory they cover is
 * never opened: skipping another app should cost nothing.
 * @returns The merged tokens and the files they came from.
 */
export function discoverProjectTheme(
    rootDir: string,
    extraDirs: readonly string[] = [],
    ignore: readonly string[] = [],
): ThemeDiscovery {
    const matcher = createRootIgnoreMatcher(rootDir, ignore);
    const normalizedRoot = normalize(rootDir);
    const bases = [
        rootDir,
        ...extraDirs.filter(dir => {
            const normalized = normalize(dir);
            return normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}/`);
        }),
    ];
    const walked = walkProjectStylesheets(bases, {
        prune: dir => matcher.coversTree(dir),
        ignoresFile: file => matcher.ignoresFile(file),
    });

    const themes: ParsedTheme[] = [];
    const files: string[] = [];
    for (const file of walked.files) {
        const content = walked.texts.get(file);
        // A cheap text test before parsing: most stylesheets have no @theme,
        // and one that could not be read has no text at all.
        if (!content?.includes('@theme')) continue;
        themes.push(parseThemeBlocks(content));
        files.push(file);
    }

    return {
        theme: themes.length > 0 ? mergeThemes(themes) : null,
        files,
        scanned: walked.files,
        gitignoreFiles: walked.gitignoreFiles,
    };
}
