#!/usr/bin/env node
// Remove the `.gitignore` stub wasm-pack writes into each output directory.
//
// wasm-pack drops a `.gitignore` containing `*` into `pkg/`, `pkg-node/` and
// `pkg-parser/`. Left in place it hides the artefacts from the publish step's
// file list and from turbo's output hashing, so the build used to end with a
// shell `rm -f` over the three paths. That was the one POSIX command in the
// build chain, and the reason the chain had never run on a Windows shell.
// Doing it here keeps the build script free of shell builtins.

import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The wasm-pack output directories the build produces. */
export const OUTPUT_DIRS = ['pkg', 'pkg-node', 'pkg-parser'];

/**
 * Delete the stub from every output directory that has one.
 *
 * A missing directory or file is not an error, matching `rm -f`: the build
 * can be re-run after a partial failure and must not trip over its own
 * earlier cleanup.
 *
 * @param {string} pkgDir - The `packages/core` directory.
 * @returns {string[]} The paths that were removed.
 */
export function stripWasmPackGitignore(pkgDir) {
    const removed = [];
    for (const dir of OUTPUT_DIRS) {
        const stub = path.join(pkgDir, dir, '.gitignore');
        try {
            rmSync(stub);
            removed.push(stub);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
    }
    return removed;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    stripWasmPackGitignore(pkgDir);
}
