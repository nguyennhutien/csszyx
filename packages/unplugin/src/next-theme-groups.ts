/**
 * `szcn` theme-group registration for the Next loader lanes.
 *
 * Every other bundler gets this through the `virtual:csszyx/theme-groups`
 * module the plugin resolves. A Turbopack/webpack loader cannot: it is handed
 * one file at a time and has no way to resolve a `virtual:` specifier. Without
 * it, an app's custom `@theme` tokens never reach `registerSzcnGroups`, so
 * `szcn` keeps both classes on a token collision and the stylesheet order picks
 * the winner instead of the author — silently, and only on this lane.
 *
 * So this writes a REAL module next to the other generated csszyx files and
 * hands back its path for the loader to import. The path is stable for a given
 * project, which keeps it out of the loader's cache identity: only the file's
 * contents change when the theme does.
 *
 * @module
 */
import fs from 'node:fs';
import path from 'node:path';

import { discoverProjectTheme } from './theme-discovery.js';
import { createThemeGroupsModule } from './virtual-modules.js';

/** File name inside the project's generated-output directory. */
const THEME_GROUPS_FILE = 'theme-groups.mjs';

/**
 * Resolved path per project root, or null when the project has no tokens
 * worth registering. Computed once per process: the answer needs a full
 * stylesheet walk, which must not run per transformed module.
 */
const resolvedByRoot = new Map<string, string | null>();

/**
 * Write the registration module for a project and return its path.
 *
 * Returns null when no stylesheet declares tokens in a category `szcn` groups
 * by. Nothing is written and nothing should be imported in that case — an
 * empty registration would be a module every szcn-using file pays for and no
 * merge would change.
 *
 * @param root - Project root the loader is running under.
 * @param outputDir - Directory generated csszyx files live in.
 * @returns Absolute path to the written module, or null when there is nothing
 * to register.
 */
export function ensureNextThemeGroupsModule(root: string, outputDir: string): string | null {
    const cached = resolvedByRoot.get(root);
    if (cached !== undefined) return cached;

    const { theme } = discoverProjectTheme(root);
    const tokens = {
        colors: theme?.colors ?? [],
        textSizes: theme?.textSizes ?? [],
        fontFamilies: theme?.fonts ?? [],
        fontWeights: theme?.fontWeights ?? [],
    };
    const hasTokens = Object.values(tokens).some(names => names.length > 0);
    if (!hasTokens) {
        resolvedByRoot.set(root, null);
        return null;
    }

    const file = path.join(outputDir, THEME_GROUPS_FILE);
    let written: string | null = file;
    try {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(file, createThemeGroupsModule(tokens), 'utf8');
    } catch {
        // A read-only or unwritable output directory is not worth failing a
        // build over: without the file the app merges exactly as it did before
        // this existed, which is under-merging, not wrong styling.
        written = null;
    }
    resolvedByRoot.set(root, written);
    return written;
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
    if (root === undefined) resolvedByRoot.clear();
    else resolvedByRoot.delete(root);
}
