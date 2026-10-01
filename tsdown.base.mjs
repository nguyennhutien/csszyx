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
