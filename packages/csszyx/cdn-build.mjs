import { fileURLToPath } from 'node:url';

/**
 * The CDN bundles, for a `<script>` tag: unpkg and jsdelivr serve the
 * production one at the package root. Two of them, as React ships two: the
 * production one prints each diagnostic as its code, its args and its page,
 * and `browser.dev.iife.js` prints the sentence, with the development
 * warnings the production one folds out, for a page under development, which
 * has no build log to read them in.
 */
export const CDN_BUNDLES = [
    { file: 'browser.iife.js', mode: 'production' },
    { file: 'browser.dev.iife.js', mode: 'development' },
];

/**
 * How a build resolves the csszyx packages the way an npm user's does: through
 * `node_modules` to each package's built `dist`. esbuild otherwise reads the
 * repository's tsconfig `paths`, which point `@csszyx/compiler` and its
 * siblings at their sources, a layout no user gets. One place for every
 * esbuild build that has to see what users get: the CDN bundles below and
 * the app bundles of `scripts/check-package-size.mjs`. (Vite reads no tsconfig
 * `paths` unless `resolve.tsconfigPaths` is set.)
 */
export const INSTALLED_RESOLUTION = Object.freeze({ tsconfigRaw: '{}' });

/** The entry every CDN bundle is built from. */
const ENTRY = fileURLToPath(new URL('./src/browser.ts', import.meta.url));

/**
 * The esbuild options of one CDN bundle, without its output: `tsdown.config.mjs`
 * writes the file from them and `scripts/check-package-size.mjs` rebuilds it
 * in memory to read the order its modules are laid out in, so the two cannot
 * drift.
 *
 * Still esbuild rather than Rolldown: the bundle is minified whole, so the
 * comment handling that moved the library entries to Rolldown does not apply.
 *
 * {@link INSTALLED_RESOLUTION} keeps the repository's tsconfig `paths` out, so
 * `@csszyx/compiler` resolves to its built `dist`, as it does for an npm
 * user, and not to its source. From the source the bundle got none of the
 * layout the compiler's build sets up for gzip (the per-key rows ahead of the
 * key tables, `packages/compiler/tsdown.config.mjs`), and it carried two
 * copies of the error class: the source's, and `dist/errors.mjs` through the
 * `@csszyx/compiler/errors` import, which no path maps (16,117 gzip bytes
 * against 15,854 from `dist`, 2026-10-21). The package's own sources need
 * nothing from a tsconfig that esbuild reads.
 *
 * @param {'production' | 'development'} mode the `process.env.NODE_ENV` to define
 * @returns {import('esbuild').BuildOptions} the options
 */
export function cdnBuildOptions(mode) {
    return {
        entryPoints: [ENTRY],
        bundle: true,
        minify: true,
        platform: 'browser',
        format: 'iife',
        ...INSTALLED_RESOLUTION,
        define: {
            'process.env.NODE_ENV': JSON.stringify(mode),
            // A page loading this over a CDN has no `process`, so any
            // surviving read is a ReferenceError waiting for whoever makes
            // that path reachable. The hint it guards tells you to run the
            // project scanner, which a script-tag page has no project for —
            // so the honest substitution is "silenced".
            'process.env.CSSZYX_NO_PROJECT_SCAN_HINT': '"1"',
            // A script-tag page cannot set an environment variable, so the
            // switch that mutes sz warnings is never on here.
            'process.env.CSSZYX_QUIET_SZ_WARNINGS': 'undefined',
            // A script-tag page has no server render, so the development sz
            // warnings that every other bundle keeps to Node print in the
            // browser here (`szNodeWarningsUnmuted`). The production bundle
            // folds them out on `NODE_ENV` before this is read.
            ...(mode === 'development'
                ? { 'globalThis.__CSSZYX_SZ_WARNINGS_IN_BROWSER__': 'true' }
                : {}),
        },
    };
}
