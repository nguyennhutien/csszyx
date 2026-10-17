/**
 * Every file the engine's source digest reads must invalidate the engine's
 * cached build. The compiler bakes in the digest it expects at its own build,
 * so an engine replayed from turbo's cache after a digest input changed would
 * disagree with a freshly built compiler, and every engine call would throw
 * `engine-version-skew`. Files inside `packages/core` are default inputs of
 * the package; anything outside it has to be named.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DIGEST_FILES, engineDigest } from './engine-digest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `turbo.json`, which carries `//` comments on their own lines.
 *
 * @returns {Record<string, any>} The parsed configuration.
 */
function turboConfig() {
    const text = readFileSync(path.join(ROOT, 'turbo.json'), 'utf8');
    return JSON.parse(text.replaceAll(/^\s*\/\/.*$/gm, ''));
}

test('the engine build is invalidated by every digest input outside its package', () => {
    const task = turboConfig().tasks['@csszyx/core#build'];
    assert.ok(task, '@csszyx/core#build declares its inputs');
    assert.ok(task.inputs.includes('$TURBO_DEFAULT$'), 'it keeps the package files as inputs');
    for (const file of DIGEST_FILES.filter(file => !file.startsWith('packages/core/'))) {
        assert.ok(task.inputs.includes(`$TURBO_ROOT$/${file}`), `${file} is an input`);
    }
});

test('the engine build keeps the outputs of the generic build', () => {
    const { tasks } = turboConfig();
    assert.deepEqual(tasks['@csszyx/core#build'].outputs, tasks.build.outputs);
    assert.deepEqual(tasks['@csszyx/core#build'].env, tasks.build.env);
    assert.deepEqual(tasks['@csszyx/core#build'].dependsOn, tasks.build.dependsOn);
});

/**
 * A repository holding only what the digest reads.
 *
 * @param {Record<string, string>} files - Repository-relative path to content.
 * @returns {string} Its root; removed after the test.
 */
function repository(files) {
    const root = mkdtempSync(path.join(tmpdir(), 'csszyx-engine-digest-'));
    test.after(() => rmSync(root, { recursive: true, force: true }));
    const all = {
        'packages/core/Cargo.toml': '[package]\n',
        'Cargo.lock': '# lock\n',
        'packages/core/src/lib.rs': 'fn main() {}\n',
        ...files,
    };
    for (const [file, content] of Object.entries(all)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), content);
    }
    return root;
}

test('files that are not engine source leave the digest alone', () => {
    // turbo does not hash them, so they must not move the digest the compiler
    // bakes in either: the engine would be replayed with the old one.
    const clean = engineDigest({ root: repository({}) });
    const stray = engineDigest({
        root: repository({
            'packages/core/src/.DS_Store': 'finder',
            'packages/core/src/.#lib.rs': 'emacs lock',
            'packages/core/src/lib.rs.swp': 'vim swap',
            'packages/core/src/.cache/x.rs': 'hidden directory',
            'packages/core/src/notes.md': 'notes',
        }),
    });
    assert.equal(stray, clean);
});

test('a path is hashed as UTF-8, as build.rs hashes it', () => {
    const files = {
        'Cargo.lock': '# lock\n',
        'packages/core/Cargo.toml': '[package]\n',
        'packages/core/src/lib.rs': 'fn main() {}\n',
        'packages/core/src/\u00e9t\u00e9\u2192.rs': 'const X: u8 = 1;\r\n',
    };
    const expected = createHash('sha256');
    for (const file of Object.keys(files).sort((a, b) =>
        Buffer.compare(Buffer.from(a), Buffer.from(b)),
    )) {
        expected.update(Buffer.from(file, 'utf8'));
        expected.update(Buffer.from([0]));
        expected.update(Buffer.from(files[file].replaceAll('\r\n', '\n'), 'utf8'));
        expected.update(Buffer.from([0]));
    }
    assert.equal(engineDigest({ root: repository(files) }), expected.digest('hex').slice(0, 16));
});
