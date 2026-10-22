/**
 * `@csszyx/unplugin` and `@csszyx/compiler` ship ES modules, which every Node
 * in their `engines` loads with `require()` as well.
 *
 * A CommonJS config (`next.config.js`, `postcss.config.cjs`, a Jest
 * transformer) still `require()`s them, so each subpath is required here in a
 * child process, on whatever Node runs this file. CI runs it once more on the
 * lowest Node the packages accept, which is the one that matters: the check
 * pins that version to `engines`.
 *
 * The exception is what `@csszyx/runtime` loads. The runtime ships CommonJS,
 * and a Jest suite runs it inside Jest's own module system, which cannot
 * `require()` an ES module (Jest 29.7, 30.0 and 30.5 all fail), so those
 * compiler subpaths keep a CommonJS file, and only those.
 *
 * Reads the built packages and FAILS when they are not built, so a missing
 * input never reads as a pass.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ESM_ONLY = ['unplugin', 'compiler'];

/**
 * A package's manifest.
 *
 * @param {string} name - The directory under `packages/`.
 * @returns {{ exports: Record<string, Record<string, unknown>>, engines: { node: string } }} The manifest.
 */
function manifest(name) {
    return JSON.parse(readFileSync(path.join(ROOT, 'packages', name, 'package.json'), 'utf8'));
}

/**
 * The specifier for each subpath a package exports.
 *
 * @param {string} name - The directory under `packages/`.
 * @returns {Array<[string, Record<string, unknown>]>} Specifier and export entry.
 */
function subpaths(name) {
    return Object.entries(manifest(name).exports).map(([subpath, entry]) => [
        subpath === '.' ? `@csszyx/${name}` : `@csszyx/${name}${subpath.slice(1)}`,
        entry,
    ]);
}

/**
 * Run a CommonJS script from inside `packages/unplugin`, where every
 * specifier resolves. It must exit cleanly and print nothing to stderr: a Node
 * that loads an ES module through `require()` only under a warning fails here.
 *
 * @param {string} script - The script.
 * @returns {string} What it printed on stdout.
 */
function runCommonJs(script) {
    const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
        cwd: path.join(ROOT, 'packages/unplugin'),
        encoding: 'utf8',
    });
    assert.equal(stderr, '');
    assert.equal(status, 0);
    return stdout;
}

/**
 * The packages an app's own modules import, so a Jest suite loads them inside
 * its module system; the build-time packages run in Node's.
 */
const APP_PACKAGES = ['runtime', 'dynamic', 'types', 'csszyx'];

/**
 * The `@csszyx/compiler` subpaths a CommonJS file of an app package requires,
 * and those the compiler's own CommonJS files require in turn: `./browser`
 * reaches its reporter through `@csszyx/compiler/report`.
 *
 * @returns {Set<string>} The specifiers.
 */
function compilerSubpathsRequiredFromCommonJs() {
    const found = new Set();
    for (const name of [...APP_PACKAGES, 'compiler']) {
        const dist = path.join(ROOT, 'packages', name, 'dist');
        if (!existsSync(dist)) continue;
        for (const file of readdirSync(dist)) {
            if (!file.endsWith('.cjs')) continue;
            const text = readFileSync(path.join(dist, file), 'utf8');
            for (const [, specifier] of text.matchAll(
                /require\("(@csszyx\/compiler(?:\/[\w-]+)?)"\)/g,
            )) {
                found.add(specifier);
            }
        }
    }
    return found;
}

/**
 * Whether an export entry ships a CommonJS file. The compiler root's `require`
 * condition carries declarations only, for CommonJS TypeScript.
 *
 * @param {Record<string, any>} entry - An `exports` entry.
 * @returns {boolean} Whether `require` resolves to a file of its own.
 */
function hasCommonJs(entry) {
    return typeof entry.require?.default === 'string';
}

for (const name of ESM_ONLY) {
    for (const [specifier, entry] of subpaths(name)) {
        test(`${specifier}: require() loads it`, () => {
            const target =
                typeof entry.default === 'string' ? entry.default : entry.require?.default;
            assert.ok(
                existsSync(path.join(ROOT, 'packages', name, target)),
                `build packages/${name} first`,
            );
            const stdout = runCommonJs(
                `const m = require(${JSON.stringify(specifier)}); process.stdout.write(typeof m);`,
            );
            assert.match(stdout, /^(object|function)$/);
        });
    }
}

test('require() of the PostCSS plugin returns the plugin itself', () => {
    // Next loads a PostCSS plugin with a bare `require()` and checks
    // `.postcss === true` on what comes back.
    const stdout = runCommonJs(
        "const p = require('@csszyx/unplugin/postcss'); process.stdout.write(typeof p + ' ' + p.postcss);",
    );
    assert.equal(stdout, 'function true');
});

test('require() and import() hand out the same error classes', () => {
    // A second CommonJS copy of a class makes `instanceof` false for an error
    // the plugin threw, checked by a config that required the class.
    const specifiers = ESM_ONLY.flatMap(name =>
        subpaths(name)
            .filter(([, entry]) => !hasCommonJs(entry))
            .map(([specifier]) => specifier),
    );
    const stdout = runCommonJs(`
        const specifiers = ${JSON.stringify(specifiers)};
        (async () => {
            const checked = [];
            for (const specifier of specifiers) {
                const required = require(specifier);
                const imported = await import(specifier);
                for (const [key, value] of Object.entries(imported)) {
                    if (typeof value !== 'function' || !(value.prototype instanceof Error)) continue;
                    if (required[key] !== value) throw new Error(specifier + ' ' + key + ' differs');
                    checked.push(key);
                }
            }
            process.stdout.write(checked.sort().join(','));
        })().catch(error => { console.error(error.message); process.exit(1); });
    `);
    assert.match(stdout, /EngineVersionSkewError/);
});

test('only the compiler subpaths an app package requires from CommonJS keep a CommonJS build', () => {
    const required = compilerSubpathsRequiredFromCommonJs();
    assert.ok(required.size > 0, 'build packages/runtime first');
    const withCommonJs = new Set(
        ESM_ONLY.flatMap(name =>
            subpaths(name)
                .filter(([, entry]) => hasCommonJs(entry))
                .map(([specifier]) => specifier),
        ),
    );
    assert.deepEqual([...withCommonJs].sort(), [...required].sort());
    for (const name of ESM_ONLY) {
        for (const [specifier, entry] of subpaths(name)) {
            if (!hasCommonJs(entry)) continue;
            assert.match(String(entry.require.default), /\.cjs$/, specifier);
        }
    }
});

test('CI runs this file on the lowest Node of `engines`', () => {
    const ranges = new Set(ESM_ONLY.map(name => manifest(name).engines.node));
    assert.equal(ranges.size, 1, `one engines range: ${[...ranges].join(' | ')}`);
    const [range] = ranges;
    const lowest = /^\^(\d+\.\d+\.\d+)/.exec(range)?.[1];
    assert.ok(lowest, `the range starts with a caret version: ${range}`);
    const workflow = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const step = new RegExp(
        `node-version: "${lowest.replaceAll('.', '\\.')}"[\\s\\S]{0,400}?node --test scripts/build-tests/require-esm\\.test\\.mjs`,
    );
    assert.ok(step.test(workflow), `ci.yml runs this file under node-version "${lowest}"`);
});
