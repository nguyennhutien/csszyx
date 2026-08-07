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
import fs from 'node:fs';
import path from 'node:path';

import { mergeThemes, type ParsedTheme, parseThemeBlocks } from './theme-scanner.js';

/**
 * Directories a project's own stylesheets never live in.
 *
 * Dot-directories are skipped separately, which also keeps the walk out of
 * `.csszyx/` — the directory this discovery's own output is written to.
 */
export const THEME_SCAN_IGNORE_DIRS: ReadonlySet<string> = new Set([
    'node_modules',
    '.next',
    '.git',
    'dist',
    'build',
    '.turbo',
]);

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
}

/**
 * Normalize a path for prefix comparison across platforms.
 *
 * @param value - Filesystem path.
 * @returns The path with POSIX separators and no trailing slash.
 */
function normalize(value: string): string {
    const posix = value.replace(/\\/g, '/');
    return posix.endsWith('/') ? posix.slice(0, -1) : posix;
}

/**
 * Collect every `.css` file under a directory, skipping build output.
 *
 * @param dir - Directory to walk.
 * @param out - Accumulator for absolute file paths.
 */
function walkCss(dir: string, out: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!THEME_SCAN_IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                walkCss(path.join(dir, entry.name), out);
            }
            continue;
        }
        if (entry.name.endsWith('.css')) {
            out.push(path.join(dir, entry.name));
        }
    }
}

/**
 * Walk a project for `@theme` blocks and merge what they declare.
 *
 * @param rootDir - Project root to walk.
 * @param extraDirs - Directories outside the root to include as well; ones
 * already inside the root are skipped so their files are not read twice.
 * @returns The merged tokens and the files they came from.
 */
export function discoverProjectTheme(
    rootDir: string,
    extraDirs: readonly string[] = [],
): ThemeDiscovery {
    const cssFiles: string[] = [];
    walkCss(rootDir, cssFiles);
    const normalizedRoot = normalize(rootDir);
    for (const dir of extraDirs) {
        const normalized = normalize(dir);
        if (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)) continue;
        walkCss(dir, cssFiles);
    }

    const themes: ParsedTheme[] = [];
    const files: string[] = [];
    for (const file of cssFiles) {
        let content: string;
        try {
            content = fs.readFileSync(file, 'utf-8');
        } catch {
            continue;
        }
        // A cheap text test before parsing: most stylesheets have no @theme.
        if (!content.includes('@theme')) continue;
        themes.push(parseThemeBlocks(content));
        files.push(file);
    }

    return {
        theme: themes.length > 0 ? mergeThemes(themes) : null,
        files,
        scanned: cssFiles,
    };
}
