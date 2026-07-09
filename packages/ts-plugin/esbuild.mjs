#!/usr/bin/env node
// Bundle the tsserver plugin with esbuild, inlining @csszyx/tooling-metadata so
// the published package is self-contained (no runtime dependency to resolve).
// - typescript is external: the host injects it via `modules.typescript`, and
//   only type-level imports reference it, so nothing is required at runtime.
// - @csszyx/tooling-metadata is bundled inline and tree-shaken to the data the
//   plugin actually reads. It stays a build-time (private) workspace package.
// - Output is CommonJS: tsserver `require()`s the module and calls its export.
// tsc runs first (see package.json build) to emit granular dist/*.js used by the
// unit tests plus dist/index.d.ts; this step overwrites dist/index.js with the
// standalone bundle that ships.

import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'dist/index.js',
    external: ['typescript'],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    treeShaking: true,
    minify: false,
    sourcemap: false,
    logLevel: 'info',
});
