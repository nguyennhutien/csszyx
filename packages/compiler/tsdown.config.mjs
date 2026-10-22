import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { engineDigest } from '../../scripts/engine-digest.mjs';
import { base, defineBuild } from '../../tsdown.base.mjs';

/** The engine this build is for: `src/engine-identity.ts` refuses any other. */
const ENGINE_VERSION = JSON.parse(
    readFileSync(new URL('../core/package.json', import.meta.url), 'utf8'),
).version;

/** The development reporter's source, as the browser entries import it. */
const REPORT_SOURCE = fileURLToPath(new URL('./src/report.ts', import.meta.url));

/**
 * Leaves the development reporter out of every entry and imports it as the
 * package's `./report` subpath, which an app resolves to the separate build of
 * it. A bare package name, so the bundler writes it as given; `output.paths`
 * on the source path wrote `./@csszyx/compiler/report`.
 */
const reportAsSubpath = {
    name: 'csszyx-report-subpath',
    resolveId(source, importer) {
        if (source !== './report.js' || importer === undefined) return null;
        return path.resolve(path.dirname(importer), 'report.ts') === REPORT_SOURCE
            ? { id: '@csszyx/compiler/report', external: true }
            : null;
    },
};

/** What every build of the package shares. */
const shared = {
    ...base,
    platform: 'neutral',
    // `csstype` is a dependency, imported by the declarations: inlined, it was
    // most of 1.9 MB of `.d.ts`, which a React or Vue app with TypeScript
    // already installs once for `@types/react` or `@vue/runtime-dom`.
    //
    // `./report.js` is the development reporter, which the browser entries
    // import by a relative path so every tool that runs the sources resolves
    // it without a build. It is built on its own (see the last build below):
    // each entry leaves it out and reaches it as the package's `./report`
    // subpath, so no entry bundles a copy.
    deps: { neverBundle: ['csstype'] },
    plugins: [reportAsSubpath],
    define: {
        __CSSZYX_ENGINE_VERSION__: JSON.stringify(ENGINE_VERSION),
        __CSSZYX_ENGINE_DIGEST__: JSON.stringify(engineDigest()),
    },
};

/**
 * The entries `@csszyx/runtime` loads. The runtime ships CommonJS, and a Jest
 * suite runs it in Jest's own module system, which cannot `require()` an ES
 * module, so these keep a CommonJS build. Everything else runs in Node, which
 * can.
 */
const RUNTIME_ENTRIES = {
    // Browser-pure transform (no oxc-parser or native deps): what @csszyx/dynamic and
    // @csszyx/runtime pull into an app bundle.
    'transform-core': 'src/transform-core.ts',
    // The depth limit, its error and the key guard on their own, so the
    // runtime's `core` and `merge` entries do not pull the property tables.
    'sz-limits': 'src/sz-limits.ts',
    // The error csszyx throws and its guard, which `@csszyx/runtime` and
    // `csszyx` re-export: `SzDepthError` above extends its class, and an
    // entry of this build shares the one class with it.
    errors: 'src/errors.ts',
    // The stand-alone keyword families and their pure settlement, for the
    // runtime's `szv` merge, without the transform's property tables.
    'keyword-families': 'src/keyword-families.ts',
    'bool-class': 'src/bool-class.ts',
    'color-var': 'src/color-var.ts',
    'spacing-var': 'src/spacing-var.ts',
};

export default defineBuild([
    {
        ...shared,
        format: ['esm'],
        // The per-key rows in a chunk of their own, so an app bundle can place
        // them before the key tables' chunk, which the engine entries share:
        // the property category map and the capability table, which both
        // spell PROPERTY_MAP's keys. Without the group the browser entry
        // measured 214 bytes larger (16,639 against 16,425); with the
        // capability table alone in it, the category map stayed in the
        // lowering's chunk, after the tables, and measured 93 larger (16,425
        // against 16,332). Where the chunk lands comes from the imports in
        // `src/transform-core.ts`; the order inside it does not (swapping the
        // two imports built the same chunk). The test names `.ts` sources: the
        // declaration build runs these groups over a module per `.d.ts`, and
        // a match put its placeholder code in the chunk.
        outputOptions: {
            ...shared.outputOptions,
            codeSplitting: {
                groups: [
                    {
                        name: 'per-key-rows',
                        test: /[\\/]src[\\/](?:property-types|sz-capabilities\.generated)\.ts$/,
                    },
                ],
            },
        },
        entry: {
            ...RUNTIME_ENTRIES,
            index: 'src/index.ts',
            'migrate-rust': 'src/migrate-rust.ts',
            // Every function that calls the engine; the root never loads it.
            engine: 'src/engine.ts',
            // What the adapters, the CLI and the build plugin share; not a stable API.
            internal: 'src/internal.ts',
        },
        hooks: {
            // The root is an ES module, and the declarations of `@csszyx/runtime`
            // and `@csszyx/types` that a CommonJS project reads import its types.
            // Under `module: node16` TypeScript refuses that import (TS1479)
            // unless the root offers declarations to `require`, so it gets one
            // line that names the ES declarations with the resolution mode they
            // need; nothing is loaded at run time.
            async 'build:done'(ctx) {
                const fs = await import('node:fs/promises');
                const path = await import('node:path');
                await fs.writeFile(
                    path.join(ctx.options.outDir, 'index.d.cts'),
                    "export type * from './index.mjs' with { 'resolution-mode': 'import' };\n",
                );
            },
        },
    },
    {
        ...shared,
        clean: false,
        format: ['cjs'],
        entry: RUNTIME_ENTRIES,
    },
    {
        ...shared,
        clean: false,
        // CommonJS too: the runtime entries' CommonJS builds require it, and
        // a Jest suite cannot `require()` an ES module.
        format: ['esm', 'cjs'],
        // The development renderer of a browser console line, with the
        // registry's templates: `@internal`, imported only from a `NODE_ENV`
        // branch. A build of its own, so it shares no chunk with the entries
        // Node loads: sharing the template filler split it into a chunk of
        // its own, which cost `./engine` and `./internal` ~620 gzip bytes
        // each, and imported from `./browser` by a relative path it measured
        // `./engine` +537 and `./internal` +551 (2026-10-20).
        entry: { report: 'src/report.ts' },
    },
]);
