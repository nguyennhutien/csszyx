/**
 * Defaults every published package builds with. A package's
 * `tsdown.config.mjs` spreads this and adds its entries, formats and hooks.
 *
 * - `comments`: drop regular and JSDoc comments, keep `@__PURE__` /
 *   `@__NO_SIDE_EFFECTS__` (an app's bundler tree-shakes by them) and legal
 *   comments. esbuild, which unbuild used, keeps comments inside expressions
 *   and drops every annotation once asked to minify; Rolldown can do neither.
 * - No source maps, declaration maps included: `tsconfig.base.json` turns
 *   `declarationMap` on for the editor, and the declaration plugin follows it
 *   unless told otherwise, which would ship a `.d.ts.map` per entry.
 * - `.mjs` / `.cjs` whatever the platform, as the `exports` maps name them.
 * - `clean`: on for a build, off under `--watch` — see `defineBuild`.
 */
export const base = {
    target: false,
    fixedExtension: true,
    clean: true,
    sourcemap: false,
    logLevel: 'warn',
    dts: { sourcemap: false },
    outputOptions: {
        comments: { legal: true, annotation: true, jsdoc: false },
    },
};

/**
 * Wraps a package's config (one object or an array) so `tsdown --watch` never
 * empties `dist`.
 *
 * With `clean` on, tsdown's watcher deletes every chunk of the previous build
 * when a rebuild STARTS and writes the new ones only when it ends, so a
 * playground importing the package reads a half-empty `dist` for the length of
 * the rebuild (measured on `@csszyx/types`: 21 files down to 3). Turning
 * `clean` off is the only switch for it — the same option drives both the
 * initial wipe and the per-rebuild chunk removal. The cost is that a renamed
 * or removed entry leaves its old file in `dist` until the next one-shot
 * build, which still cleans; nothing in `exports` points at a stale file.
 *
 * `inlineConfig.watch` is the CLI's `--watch` flag (`true`, or the paths
 * given to it).
 */
export function defineBuild(config) {
    return inlineConfig => {
        if (!inlineConfig.watch) {
            return config;
        }
        const noClean = entry => ({ ...entry, clean: false });
        return Array.isArray(config) ? config.map(noClean) : noClean(config);
    };
}
