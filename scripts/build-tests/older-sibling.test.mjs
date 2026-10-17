/**
 * The built plugin and compiler load beside a sibling package from before
 * 0.18, so the version checks they carry get to run.
 *
 * `@csszyx/unplugin` stops the build on a `@csszyx/runtime` from another
 * release (`runtime-version-skew`), and `@csszyx/compiler` refuses an engine
 * from another release (`engine-version-skew`). Both checks are for exactly
 * the case where the sibling is older, and an older sibling lacks the exports
 * 0.18 added. A named import of one of those fails when the module links, with
 * a bare `SyntaxError`, before either check runs; this file replaces each
 * sibling with a copy that lacks the newer export and loads the real `dist`.
 *
 * Reads the built packages and FAILS when they are not built.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Run a module in a child where `specifier` resolves to a copy of the real
 * module without `missing`.
 *
 * @param {object} input - What to replace and what to run.
 * @param {string} input.from - Package directory the real module resolves from.
 * @param {string} input.specifier - The sibling's specifier.
 * @param {string} input.missing - The export the older sibling lacks.
 * @param {string} input.script - ES module source to run; prints its verdict.
 * @returns {{ status: number | null, stdout: string, stderr: string }} The child's result.
 */
function runWithOlderSibling({ from, specifier, missing, script }) {
    const dir = mkdtempSync(path.join(tmpdir(), 'csszyx-older-sibling-'));
    try {
        const parent = pathToFileURL(path.join(from, 'package.json')).href;
        writeFileSync(
            path.join(dir, 'make-stub.mjs'),
            `const resolved = import.meta.resolve(${JSON.stringify(specifier)}, ${JSON.stringify(parent)});
const names = Object.keys(await import(resolved)).filter(n => n !== ${JSON.stringify(missing)} && n !== 'default');
process.stdout.write('import * as real from ' + JSON.stringify(resolved) + ';\\nexport const { ' + names.join(', ') + ' } = real;\\n');`,
        );
        const made = spawnSync(
            process.execPath,
            ['--experimental-import-meta-resolve', path.join(dir, 'make-stub.mjs')],
            {
                cwd: from,
                encoding: 'utf8',
            },
        );
        assert.equal(made.status, 0, made.stderr);
        const stub = path.join(dir, 'stub.mjs');
        writeFileSync(stub, made.stdout);
        writeFileSync(
            path.join(dir, 'hooks.mjs'),
            `import { registerHooks } from 'node:module';
registerHooks({
    resolve(request, context, next) {
        if (request === ${JSON.stringify(specifier)} && !context.parentURL?.endsWith('/stub.mjs')) {
            return { url: ${JSON.stringify(pathToFileURL(stub).href)}, shortCircuit: true };
        }
        return next(request, context);
    },
});`,
        );
        writeFileSync(path.join(dir, 'main.mjs'), script);
        return spawnSync(
            process.execPath,
            [
                '--import',
                pathToFileURL(path.join(dir, 'hooks.mjs')).href,
                path.join(dir, 'main.mjs'),
            ],
            { cwd: from, encoding: 'utf8' },
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('the plugin loads beside a runtime without createHydrationMangleMap', () => {
    const from = path.join(ROOT, 'packages/unplugin');
    assert.ok(existsSync(path.join(from, 'dist/vite.mjs')), 'build packages/unplugin first');
    const { status, stdout, stderr } = runWithOlderSibling({
        from,
        specifier: '@csszyx/runtime',
        missing: 'createHydrationMangleMap',
        script: `const vite = await import(${JSON.stringify(pathToFileURL(path.join(from, 'dist/vite.mjs')).href)});
process.stdout.write(typeof vite.default);`,
    });
    assert.equal(stderr.match(/SyntaxError.*/)?.[0], undefined);
    assert.equal(status, 0, stderr);
    assert.equal(stdout, 'function');
});

test('an engine without engineIdentity is refused as engine-version-skew', () => {
    const from = path.join(ROOT, 'packages/compiler');
    assert.ok(existsSync(path.join(from, 'dist/engine.mjs')), 'build packages/compiler first');
    const { status, stdout, stderr } = runWithOlderSibling({
        from,
        specifier: '@csszyx/core/native',
        missing: 'engineIdentity',
        script: `const engine = await import(${JSON.stringify(pathToFileURL(path.join(from, 'dist/engine.mjs')).href)});
try {
    engine.ensureRustTransformAvailable();
    process.stdout.write('no error');
} catch (error) {
    process.stdout.write(error.code + ' | ' + error.message.split('\\n')[0]);
}`,
    });
    assert.equal(stderr.match(/SyntaxError.*/)?.[0], undefined);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /^engine-version-skew \| .*from a release before 0\.18/);
});
