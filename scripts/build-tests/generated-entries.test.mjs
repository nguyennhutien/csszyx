// The entries the compiler writes imports to only gain names: a library built
// with one release keeps working against the next, whose entry still exports
// every name the older output imports.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BASELINE = path.join(import.meta.dirname, 'generated-entries.baseline.json');

/** Each generated entry, with the package directory that publishes it. */
const ENTRIES = [
    ['csszyx/core', 'packages/csszyx', './core'],
    ['@csszyx/runtime/core', 'packages/runtime', './core'],
    ['@csszyx/runtime/merge', 'packages/runtime', './merge'],
];

/**
 * The ESM file an entry resolves to, read from its package's `exports`.
 *
 * @param {string} dir - The package directory.
 * @param {string} subpath - The `exports` key.
 * @returns {string} The file's absolute path.
 */
function esmFile(dir, subpath) {
    const target = JSON.parse(readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8')).exports[
        subpath
    ].import;
    return path.join(ROOT, dir, typeof target === 'string' ? target : target.default);
}

test('a generated entry still exports every name it exported at the baseline', async () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    for (const [entry, dir, subpath] of ENTRIES) {
        const names = new Set(Object.keys(await import(pathToFileURL(esmFile(dir, subpath)).href)));
        const lost = (baseline[entry] ?? []).filter(name => !names.has(name));
        assert.deepEqual(lost, [], `${entry} no longer exports ${lost.join(', ')}`);
    }
});

test('the baseline names every generated entry', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    assert.deepEqual(Object.keys(baseline).sort(), ENTRIES.map(([entry]) => entry).sort());
});
