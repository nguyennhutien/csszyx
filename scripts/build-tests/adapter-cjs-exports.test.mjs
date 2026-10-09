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
 * The declarations follow the same split: TypeScript reads the `types` of the
 * condition it resolves through, and one `types` beside `import` and `require`
 * sent `import vue = require(...)` to `index.d.mts`, which TypeScript refuses
 * from a CommonJS file (TS1471) while `index.d.cts` shipped unreferenced.
 *
 * Reads the built packages and FAILS when they are not built, so a missing
 * input never reads as a pass.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
/** The packages whose CommonJS lane is checked against their ES module lane. */
const PACKAGES = ['svelte-adapter', 'vue-adapter'];

/**
 * The target a condition-ordered export entry gives, as Node and TypeScript
 * walk it: the first key, in the entry's own order, that is set.
 *
 * @param {unknown} entry - An `exports` value.
 * @param {ReadonlySet<string>} conditions - The conditions that are set.
 * @returns {string | undefined} The target path.
 */
function resolveExport(entry, conditions) {
    if (typeof entry === 'string') return entry;
    for (const [key, value] of Object.entries(entry ?? {})) {
        if (key !== 'default' && !conditions.has(key)) continue;
        const target = resolveExport(value, conditions);
        if (target !== undefined) return target;
    }
    return undefined;
}

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

// Every published package, not only the adapters: `@csszyx/types` carried the
// same single `types` entry after the adapters were fixed.
const PUBLISHED = readdirSync(path.resolve(import.meta.dirname, '../../packages')).filter(name => {
    const manifest = path.resolve(import.meta.dirname, '../../packages', name, 'package.json');
    return existsSync(manifest) && !JSON.parse(readFileSync(manifest, 'utf8')).private;
});

for (const name of PUBLISHED) {
    const root = path.resolve(import.meta.dirname, '../../packages', name);
    const { exports } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

    test(`@csszyx/${name}: each lane reads its own declarations`, () => {
        for (const [subpath, entry] of Object.entries(exports ?? {})) {
            const required = resolveExport(entry, new Set(['require']));
            const imported = resolveExport(entry, new Set(['import']));
            // Only subpaths with a CommonJS and an ES module file have two lanes.
            if (!required?.endsWith('.cjs') || !imported?.endsWith('.mjs')) continue;
            for (const [lane, file] of [
                ['import', imported],
                ['require', required],
            ]) {
                const declarations = file.replace(/\.([cm])js$/, '.d.$1ts');
                assert.equal(
                    resolveExport(entry, new Set([lane, 'types'])),
                    declarations,
                    `${subpath} ${lane}`,
                );
            }
        }
    });
}
