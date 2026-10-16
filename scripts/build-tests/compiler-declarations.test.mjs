/**
 * `@csszyx/compiler`'s declarations import `csstype` instead of carrying a
 * copy of it.
 *
 * Inlined, `csstype` made up most of 1.9 MB of `.d.ts` in every compiler
 * install, once per format, while every React or Vue app with TypeScript
 * already installs it for `@types/react` or `@vue/runtime-dom`.
 *
 * Reads the built package and FAILS when it is not built.
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMPILER = path.join(ROOT, 'packages/compiler');

test('the compiler declarations import csstype and do not inline it', () => {
    const manifest = JSON.parse(readFileSync(path.join(COMPILER, 'package.json'), 'utf8'));
    assert.ok(manifest.dependencies?.csstype, 'csstype is a dependency of @csszyx/compiler');
    for (const file of ['dist/index.d.mts', 'dist/index.d.cts']) {
        const declarations = readFileSync(path.join(COMPILER, file), 'utf8');
        assert.match(declarations, /from ['"]csstype['"]/, `${file} imports csstype`);
        // The inlined copy carried csstype's `StandardLonghandProperties`.
        assert.doesNotMatch(declarations, /interface StandardLonghandProperties/, file);
        assert.ok(statSync(path.join(COMPILER, file)).size < 400_000, `${file} stays small`);
    }
});
