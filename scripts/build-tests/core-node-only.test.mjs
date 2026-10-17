/**
 * `@csszyx/core` runs at build time, in Node, and has no browser entry.
 *
 * A bundler building for the browser must fail to resolve it, loudly and at
 * build time. A browser stub that throws on import was rejected: a namespace
 * import of it builds green and leaves every export undefined until a user
 * reaches the call. Node resolves the one wasm build that ships.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// A package that depends on the engine, so the specifier resolves from it.
const FROM = path.join(ROOT, 'packages/unplugin');
const { build } = createRequire(path.join(ROOT, 'package.json'))('esbuild');

/**
 * Bundle one import of the engine for a platform.
 *
 * @param {'browser' | 'node'} platform - The esbuild platform.
 * @param {string} contents - The entry module.
 * @returns {Promise<{ errors: string[], inputs: string[] }>} Error texts, and the files the bundle read.
 */
async function bundle(platform, contents) {
    try {
        const result = await build({
            stdin: { contents, resolveDir: FROM, loader: 'js' },
            bundle: true,
            write: false,
            metafile: true,
            platform,
            format: 'esm',
            logLevel: 'silent',
        });
        return { errors: [], inputs: Object.keys(result.metafile.inputs) };
    } catch (error) {
        return { errors: error.errors.map(e => e.text), inputs: [] };
    }
}

for (const contents of [
    "import { encode } from '@csszyx/core'; console.log(encode(1));",
    "import * as core from '@csszyx/core'; console.log(core);",
]) {
    test(`a browser build fails to resolve the engine: ${contents.split(';')[0]}`, async () => {
        const { errors } = await bundle('browser', contents);
        assert.equal(errors.length, 1, 'the build fails');
        assert.match(errors[0], /Could not resolve "@csszyx\/core"/);
    });
}

test('Node resolves the engine to its one wasm build', async () => {
    const { errors, inputs } = await bundle('node', "export { encode } from '@csszyx/core';");
    assert.deepEqual(errors, []);
    assert.ok(
        inputs.some(file => file.includes('packages/core/pkg-parser/')),
        `read ${inputs.join(', ')}`,
    );
});
