/**
 * PostCSS plugin that points a Tailwind stylesheet at csszyx's safelist.
 *
 * Every bundler csszyx has a plugin for injects the `@source` directive into
 * the CSS entry itself. Next's Turbopack lane has no such hook: there csszyx
 * only writes source files, and the stylesheet goes straight to
 * `@tailwindcss/postcss`. This plugin is the one hook that lane does offer,
 * so with it in `postcss.config` no project has to hand-write the directive.
 *
 * Order matters: `@tailwindcss/postcss` compiles the stylesheet in its own
 * `Once`, so this plugin has to be listed BEFORE it. Next serialises the
 * PostCSS config to a worker, so the plugin is referenced by package name
 * (`'@csszyx/unplugin/postcss'`), never as a function.
 */

import type { PluginCreator, Root } from 'postcss';
import {
    computeSafelistRelPath,
    DEFAULT_SAFELIST_FILES,
    importParamsNameTailwind,
} from './safelist-source.js';

/** Options for {@link csszyxPostcss}. */
export interface CsszyxPostcssOptions {
    /**
     * Project root the safelist files are written under. Defaults to the
     * working directory, which is the project directory under Next.
     */
    root?: string;
    /**
     * Safelist files to point at, relative to `root`. Defaults to every file
     * csszyx writes; a file that does not exist yet costs nothing, Tailwind
     * scans nothing for it and does not fail.
     */
    safelistFiles?: readonly string[];
}

/**
 * @param root - parsed stylesheet
 * @returns true if any `@import` at-rule names the tailwindcss package
 */
function rootImportsTailwind(root: Root): boolean {
    let found = false;
    root.walkAtRules('import', rule => {
        if (importParamsNameTailwind(rule.params)) {
            found = true;
            return false;
        }
        return undefined;
    });
    return found;
}

/**
 * @param root - parsed stylesheet
 * @returns the path each existing `@source` at-rule names, unquoted
 */
function existingSourcePaths(root: Root): Set<string> {
    const paths = new Set<string>();
    root.walkAtRules('source', rule => {
        const match = /^["']([^"']*)["']$/.exec(rule.params.trim());
        if (match?.[1] !== undefined) paths.add(match[1]);
    });
    return paths;
}

/**
 * Create the plugin.
 *
 * @param options - where the safelist files live.
 * @returns a PostCSS plugin that appends one `@source` per safelist file to
 *   any stylesheet importing tailwindcss, skipping paths already named.
 */
const csszyxPostcss: PluginCreator<CsszyxPostcssOptions> = (options = {}) => {
    const projectRoot = options.root ?? process.cwd();
    const safelistFiles = options.safelistFiles ?? DEFAULT_SAFELIST_FILES;
    return {
        postcssPlugin: 'csszyx',
        Once(root, { AtRule }) {
            const file = root.source?.input.file;
            if (file === undefined || !rootImportsTailwind(root)) return;
            const present = existingSourcePaths(root);
            for (const safelistFile of safelistFiles) {
                const relPath = computeSafelistRelPath(projectRoot, safelistFile, file);
                if (present.has(relPath)) continue;
                root.append(new AtRule({ name: 'source', params: `"${relPath}"` }));
            }
        },
    };
};
csszyxPostcss.postcss = true;

// The one export, so the CommonJS build is the function itself: Next loads a
// PostCSS plugin with a bare `require()` and checks `.postcss === true` on
// whatever comes back, never on a `.default` property.
export default csszyxPostcss;
