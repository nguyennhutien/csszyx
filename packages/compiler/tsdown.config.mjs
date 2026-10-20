import { readFileSync } from 'node:fs';

import { engineDigest } from '../../scripts/engine-digest.mjs';
import { base, defineBuild } from '../../tsdown.base.mjs';

/** The engine this build is for: `src/engine-identity.ts` refuses any other. */
const ENGINE_VERSION = JSON.parse(
    readFileSync(new URL('../core/package.json', import.meta.url), 'utf8'),
).version;

/** What every build of the package shares. */
const shared = {
    ...base,
    platform: 'neutral',
    // `csstype` is a dependency, imported by the declarations: inlined, it was
    // most of 1.9 MB of `.d.ts`, which a React or Vue app with TypeScript
    // already installs once for `@types/react` or `@vue/runtime-dom`.
    deps: { neverBundle: ['csstype'] },
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
        // the property category map, then the capability table. Both spell
        // PROPERTY_MAP's keys, and gzip measured smaller with the category
        // map ahead of the other two. Without the group the browser entry
        // measured 214 bytes larger (16,639 against 16,425); with the
        // capability table alone in it, the category map stayed in the
        // lowering's chunk, after the tables, and measured 93 larger (16,425
        // against 16,332). The order comes from the imports in
        // `src/transform-core.ts`. The test names `.ts` sources: the
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
        format: ['esm'],
        // The development renderer of a browser console line, with the
        // registry's templates: `@internal`, imported only from a `NODE_ENV`
        // branch, and ES module only until the runtime requires it. A build
        // of its own, so it shares no chunk with the entries Node loads:
        // sharing the template filler split it into a chunk of its own,
        // which cost `./engine` and `./internal` ~620 gzip bytes each.
        entry: { report: 'src/report.ts' },
    },
]);
