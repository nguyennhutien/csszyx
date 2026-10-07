/**
 * The Svelte and Vue adapters export the same names to `require()` as to `import`.
 *
 * `@csszyx/unplugin`'s CommonJS build reaches the adapters through
 * `require()` and calls `.preprocess` on what comes back. The adapters'
 * CommonJS files used to end in `module.exports = <default>`, which replaced
 * every named export assigned above it: `require()` returned a bare function,
 * `.preprocess` was `undefined`, and the plugin's CommonJS lane threw on the
 * first `.svelte` or `.vue` file — while the shipped `index.d.cts` declared the
 * named exports all along.
 *
 * Reads the built packages and FAILS when they are not built, so a missing
 * input never reads as a pass.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const PACKAGES = ['svelte-adapter', 'vue-adapter'];

for (const name of PACKAGES) {
    const dist = path.resolve(import.meta.dirname, '../../packages', name, 'dist');

    test(`@csszyx/${name}: require() returns the named exports import() does`, async () => {
        const cjs = path.join(dist, 'index.cjs');
        const esm = path.join(dist, 'index.mjs');
        assert.ok(existsSync(cjs) && existsSync(esm), `build packages/${name} first`);

        const required = require(cjs);
        const imported = await import(pathToFileURL(esm).href);

        assert.equal(typeof required.preprocess, 'function');
        assert.deepEqual(
            Object.keys(required)
                .filter(key => key !== '__esModule')
                .sort(),
            Object.keys(imported).sort(),
        );
    });
}
