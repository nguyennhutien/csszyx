// The `.gitignore` stubs wasm-pack writes into each output directory must be
// removed so the published package and turbo's cache see the directory as
// plain files. This used to be a shell `rm -f` in the build script — the one
// POSIX command in the chain — which a Windows shell cannot run.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { stripWasmPackGitignore } from './strip-wasm-pack-gitignore.mjs';

let root = '';
afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
});

describe('stripWasmPackGitignore', () => {
    it('removes the stub from every output directory that has one', () => {
        root = mkdtempSync(path.join(tmpdir(), 'csszyx-wasm-gi-'));
        for (const dir of ['pkg', 'pkg-node', 'pkg-parser']) {
            mkdirSync(path.join(root, dir));
            writeFileSync(path.join(root, dir, '.gitignore'), '*\n');
            writeFileSync(path.join(root, dir, 'csszyx_core_bg.wasm'), 'x');
        }

        const removed = stripWasmPackGitignore(root);

        assert.equal(removed.length, 3);
        for (const dir of ['pkg', 'pkg-node', 'pkg-parser']) {
            assert.equal(existsSync(path.join(root, dir, '.gitignore')), false);
            assert.equal(existsSync(path.join(root, dir, 'csszyx_core_bg.wasm')), true);
        }
    });

    it('is a no-op when a directory or its stub is already gone', () => {
        // `rm -f` never failed on a missing file; the replacement must not either.
        root = mkdtempSync(path.join(tmpdir(), 'csszyx-wasm-gi-'));
        mkdirSync(path.join(root, 'pkg'));

        assert.deepEqual(stripWasmPackGitignore(root), []);
    });
});
