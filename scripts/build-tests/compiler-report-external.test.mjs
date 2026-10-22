/**
 * The compiler's browser entries reach the development reporter as the
 * package's `./report` subpath, never as a copy of it.
 *
 * The sources import it by a relative path, so every tool that runs them
 * resolves it without a build; the build leaves that import out and writes
 * the subpath in its place (`packages/compiler/tsdown.config.mjs`). A copy in
 * an entry would put the template filler beside the code Node loads, which
 * measured `./engine` and `./internal` past their size budgets, and a
 * relative path left in `dist` names a file the build never writes.
 *
 * Reads the built package and FAILS when it is not built.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DIST = path.resolve(import.meta.dirname, '../../packages/compiler/dist');

/**
 * The compiler's built code files, by name.
 *
 * @returns {Array<[string, string]>} Each file name with its text.
 */
function builtCode() {
    assert.ok(existsSync(DIST), 'build packages/compiler first');
    return readdirSync(DIST)
        .filter(file => /\.(?:mjs|cjs)$/.test(file))
        .map(file => [file, readFileSync(path.join(DIST, file), 'utf8')]);
}

test('only the report build defines the reporter, and every other file imports it', () => {
    const files = builtCode();
    const defining = files
        .filter(([, text]) => text.includes('function szReport'))
        .map(([file]) => file);
    assert.deepEqual(defining.sort(), ['report.cjs', 'report.mjs']);
    // The bare package specifier, quoted: `./@csszyx/compiler/report` would
    // name a file next to the entry.
    const importing = files
        .filter(
            ([file, text]) =>
                !file.startsWith('report.') && /["']@csszyx\/compiler\/report["']/.test(text),
        )
        .map(([file]) => file);
    // `./browser` and the leaf entries that report, in both formats.
    assert.ok(
        importing.some(file => file.startsWith('transform-core')),
        importing.join(', '),
    );
    assert.ok(importing.includes('bool-class.cjs') && importing.includes('bool-class.mjs'));
});

test('no built file names the reporter by a path', () => {
    for (const [file, text] of builtCode()) {
        assert.ok(!/["'][./][^"']*report(?:\.js)?["']/.test(text), file);
    }
});
