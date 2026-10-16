/**
 * The digest of the engine's source is computed twice, by
 * `scripts/engine-digest.mjs` for the compiler's build and by
 * `packages/core/build.rs` inside the engine; the two must agree, and every
 * built artifact must report the version and digest the compiler expects.
 *
 * Reads the built packages and FAILS when they are not built.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { engineDigest } from '../engine-digest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'packages/compiler/package.json'));
const version = JSON.parse(
    readFileSync(path.join(ROOT, 'packages/core/package.json'), 'utf8'),
).version;

test('the wasm engine reports the version and the digest of this source', () => {
    const wasm = require('@csszyx/core/parser-wasm');
    assert.equal(wasm.version(), version);
    assert.equal(wasm.engine_digest(), engineDigest());
});

test('the native engine reports the version and the digest of this source', async () => {
    const native = await import(require.resolve('@csszyx/core/native'));
    assert.deepEqual(native.engineIdentity(), { version, digest: engineDigest() });
});

test('the compiler build expects this engine', () => {
    const chunks = path.join(ROOT, 'packages/compiler/dist');
    const built = readFileSync(require.resolve('@csszyx/compiler/internal'), 'utf8');
    const expectation = /version: "([^"]+)",\s*digest: "([0-9a-f]{16})"/;
    const source = [built, ...readDist(chunks)].find(text => expectation.test(text));
    assert.ok(source, 'the compiler dist carries its expected engine');
    const [, expectedVersion, expectedDigest] = source.match(expectation);
    assert.deepEqual([expectedVersion, expectedDigest], [version, engineDigest()]);
});

/**
 * The text of every `.mjs` file of a directory.
 *
 * @param {string} directory - A `dist` directory.
 * @returns {string[]} Their contents.
 */
function readDist(directory) {
    return readdirSync(directory)
        .filter(name => name.endsWith('.mjs'))
        .map(name => readFileSync(path.join(directory, name), 'utf8'));
}
