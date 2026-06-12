#!/usr/bin/env node
/**
 * Decide whether a set of changed `package.json` files carries any change that
 * can affect build / test / lint output, as opposed to publish-only metadata
 * (version, repository, engines, description, files, …).
 *
 * dorny/paths-filter can only match paths, so it treats every package.json edit
 * — including a release version bump — as a code change and runs the full
 * matrix. This script reads the actual field-level diff so a metadata-only edit
 * skips the heavy jobs.
 *
 * `isCodeRelevantChange` is exported and pure for unit testing; `main` does the
 * git/IO glue and writes `pkg_code=<bool>` to `$GITHUB_OUTPUT`.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

/**
 * package.json fields whose change can alter build / test / lint output.
 * Everything else (version, name, description, keywords, author, license,
 * repository, homepage, bugs, funding, engines, files, publishConfig, private,
 * os, cpu, packageManager) is publish-only metadata.
 */
export const CODE_RELEVANT_FIELDS = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
    'peerDependenciesMeta',
    'bundleDependencies',
    'bundledDependencies',
    'exports',
    'main',
    'module',
    'types',
    'typings',
    'bin',
    'browser',
    'imports',
    'scripts',
    'sideEffects',
    'workspaces',
    'pnpm',
];

/**
 * Order-independent JSON serialization: object keys are sorted recursively so
 * that re-ordering dependency entries (same content) is not seen as a change.
 * @param {unknown} value - Any JSON value.
 * @returns {string} Canonical JSON string.
 */
function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/**
 * Compare two parsed package.json objects (or `null` for add/delete) and report
 * whether a code-relevant field changed. Add or delete is always code-relevant.
 * @param {Record<string, unknown> | null} base - Base-ref package.json, or null if newly added.
 * @param {Record<string, unknown> | null} head - Head-ref package.json, or null if deleted.
 * @returns {boolean} True if a build/test/lint-affecting field changed.
 */
export function isCodeRelevantChange(base, head) {
    if (base === null || head === null) {
        return true;
    }
    for (const field of CODE_RELEVANT_FIELDS) {
        if (stableStringify(base[field]) !== stableStringify(head[field])) {
            return true;
        }
    }
    return false;
}

/**
 * Read a file's content at a git ref, or null if it did not exist there.
 * @param {string} ref - Git ref (sha/branch).
 * @param {string} filePath - Repo-relative path.
 * @returns {string | null} File content, or null if absent at that ref.
 */
function showAtRef(ref, filePath) {
    try {
        return execFileSync('git', ['show', `${ref}:${filePath}`], { encoding: 'utf8' });
    } catch {
        return null;
    }
}

/**
 * @param {string | null} content - Raw JSON text or null.
 * @returns {Record<string, unknown> | null} Parsed object, or null.
 */
function parseOrNull(content) {
    if (content === null) {
        return null;
    }
    try {
        return JSON.parse(content);
    } catch {
        // Unparseable package.json is itself a reason to run the full matrix.
        return { __unparseable: true };
    }
}

/**
 * CI entry: given a base ref and a newline-separated list of changed
 * package.json paths, write `pkg_code=true|false` to `$GITHUB_OUTPUT`.
 */
function main() {
    const baseRef = process.env.BASE_REF;
    const changed = (process.env.CHANGED_PKG_JSON ?? '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (changed.length === 0) {
        writeOutput(false);
        return;
    }
    if (!baseRef || /^0+$/.test(baseRef)) {
        // No usable base (first push of a branch, forced push, missing env):
        // we cannot prove the changes are metadata-only, so fail open and run
        // the full matrix.
        console.log('[pkg-gate] no usable base ref — failing open');
        writeOutput(true);
        return;
    }

    let codeRelevant = false;
    for (const filePath of changed) {
        const base = parseOrNull(showAtRef(baseRef, filePath));
        const head = parseOrNull(readFileOrNull(filePath));
        if (isCodeRelevantChange(base, head)) {
            codeRelevant = true;
            console.log(`[pkg-gate] code-relevant change: ${filePath}`);
        } else {
            console.log(`[pkg-gate] metadata-only: ${filePath}`);
        }
    }
    writeOutput(codeRelevant);
}

/**
 * @param {string} filePath - Path to read.
 * @returns {string | null} Content or null if missing (deleted in head).
 */
function readFileOrNull(filePath) {
    try {
        return readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

/**
 * @param {boolean} value - Result to publish.
 */
function writeOutput(value) {
    console.log(`[pkg-gate] pkg_code=${value}`);
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `pkg_code=${value}\n`);
    }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main();
}
