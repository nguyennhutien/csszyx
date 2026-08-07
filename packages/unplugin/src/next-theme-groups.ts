/**
 * `szcn` theme-group registration for the Next loader lanes.
 *
 * Every other bundler gets this through the `virtual:csszyx/theme-groups`
 * module the plugin resolves. A Turbopack/webpack loader cannot: it is handed
 * one file at a time and has no way to resolve a `virtual:` specifier. Without
 * it, an app's custom `@theme` tokens never reach `setSzcnGroups`, so
 * `szcn` keeps both classes on a token collision and the stylesheet order picks
 * the winner instead of the author — silently, and only on this lane.
 *
 * So this writes a REAL module next to the other generated csszyx files and
 * hands back its path for the loader to import, plus the stylesheets to watch.
 * The path is stable for a given project, which keeps it out of the loader's
 * cache identity: only the file's contents change when the theme does.
 *
 * @module
 */
import fs from 'node:fs';
import path from 'node:path';

import { discoverProjectTheme } from './theme-discovery.js';
import { createThemeGroupsModule } from './virtual-modules.js';

/** File name inside the project's generated-output directory. */
const THEME_GROUPS_FILE = 'theme-groups.mjs';

/** What one project's stylesheets currently say. */
export interface NextThemeGroups {
    /** Module to import, or null when there is nothing worth registering. */
    file: string | null;
    /** Stylesheets whose edits must regenerate the module. */
    watch: string[];
}

/** Cached answer plus the stylesheet state it was computed from. */
interface CachedGroups extends NextThemeGroups {
    /** Size and mtime of every watched stylesheet, in `watch` order. */
    signature: string;
}

const cacheByRoot = new Map<string, CachedGroups>();

/**
 * Fingerprint the stylesheets a previous scan read.
 *
 * Cheap enough to run per transformed module — a handful of `stat` calls —
 * where re-walking the project would not be. A file that vanished contributes
 * a marker rather than throwing, so deleting a stylesheet also invalidates.
 *
 * @param files - Stylesheets from the previous scan.
 * @returns A string that changes whenever any of them does.
 */
function signatureOf(files: readonly string[]): string {
    return files
        .map(file => {
            try {
                const stat = fs.statSync(file);
                return `${file}:${stat.size}:${stat.mtimeMs}`;
            } catch {
                return `${file}:gone`;
            }
        })
        .join('|');
}

/**
 * Write the registration module for a project and return it with its watch set.
 *
 * Returns a null `file` when no stylesheet declares tokens in a category `szcn`
 * groups by. Nothing is written and nothing should be imported in that case —
 * an empty registration would be a module every szcn-using file pays for and no
 * merge would change. The watch set is still returned, so adding the first
 * token to a project later is noticed.
 *
 * @param root - Project root the loader is running under.
 * @param outputDir - Directory generated csszyx files live in.
 * @returns The module to import and the stylesheets to watch.
 */
export function ensureNextThemeGroupsModule(root: string, outputDir: string): NextThemeGroups {
    const cached = cacheByRoot.get(root);
    if (cached && signatureOf(cached.watch) === cached.signature) {
        return { file: cached.file, watch: cached.watch };
    }

    const { theme, scanned } = discoverProjectTheme(root);
    const tokens = {
        colors: theme?.colors ?? [],
        textSizes: theme?.textSizes ?? [],
        fontFamilies: theme?.fonts ?? [],
        fontWeights: theme?.fontWeights ?? [],
    };
    const hasTokens = Object.values(tokens).some(names => names.length > 0);

    let file: string | null = null;
    if (hasTokens) {
        const target = path.join(outputDir, THEME_GROUPS_FILE);
        try {
            fs.mkdirSync(outputDir, { recursive: true });
            fs.writeFileSync(target, createThemeGroupsModule(tokens), 'utf8');
            file = target;
        } catch {
            // A read-only or unwritable output directory is not worth failing a
            // build over: without the file the app merges exactly as it did
            // before this existed, which is under-merging, not wrong styling.
            file = null;
        }
    }

    // Signature is taken AFTER the write, from the stylesheets only — the
    // generated module is never in the watch set. Watching a file this function
    // writes would invalidate the modules that import it on every regeneration,
    // which is the re-run cascade the loader avoids everywhere else.
    const result: CachedGroups = { file, watch: scanned, signature: signatureOf(scanned) };
    cacheByRoot.set(root, result);
    return { file, watch: scanned };
}

/**
 * Build the import specifier one module uses to reach the registration.
 *
 * Relative rather than absolute: a bundler resolves a relative specifier the
 * same way on every platform, while an absolute POSIX path is a Windows
 * hazard.
 *
 * @param fromFile - Module being transformed.
 * @param themeGroupsFile - Path returned by {@link ensureNextThemeGroupsModule}.
 * @returns A specifier that resolves from `fromFile`.
 */
export function themeGroupsSpecifier(fromFile: string, themeGroupsFile: string): string {
    const relative = path.relative(path.dirname(fromFile), themeGroupsFile).replace(/\\/g, '/');
    // `startsWith('.')` is NOT the test: the generated file lives in a DOT
    // directory, so a sibling import reads `.csszyx/theme-groups.mjs`, which a
    // bundler resolves as a package name rather than a path.
    return relative.startsWith('./') || relative.startsWith('../') ? relative : `./${relative}`;
}

/**
 * Forget the cached answer for a root. Test-only.
 *
 * @param root - Project root to drop, or omit to clear everything.
 */
export function _resetNextThemeGroupsCache(root?: string): void {
    if (root === undefined) cacheByRoot.clear();
    else cacheByRoot.delete(root);
}
