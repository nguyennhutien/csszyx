#!/usr/bin/env node
/**
 * Decide whether a `pnpm-lock.yaml` change touches a package the workspace
 * depends on DIRECTLY (declared in some package.json) — only those can change
 * build / test / lint / type output. A lockfile change confined to PURE
 * TRANSITIVE dependencies (a Dependabot transitive bump, a `pnpm dedupe`, an
 * override of a non-direct dep) is safe to skip.
 *
 * dorny/paths-filter can only match the path, so it treats every lockfile edit
 * as a code change and runs the full matrix. This reads the lockfile DIFF and
 * the workspace's declared dependency names to gate the heavy jobs — the same
 * content-aware discipline `detect-pkg-code-changes.mjs` applies to package.json.
 *
 * The pure functions are exported for unit testing; `main` does the git/IO glue
 * and writes `lock_code=<bool>` to `$GITHUB_OUTPUT`. It FAILS OPEN (true) on any
 * unusable base ref or unparseable diff — path filtering is an optimisation, not
 * the only safety net.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const LOCKFILE = 'pnpm-lock.yaml';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * Union of every dependency NAME declared across the given package.json texts.
 * @param {string[]} pkgJsonContents - Raw package.json file contents.
 * @returns {Set<string>} The set of directly-declared dependency names.
 */
export function collectDirectDeps(pkgJsonContents) {
    const names = new Set();
    for (const content of pkgJsonContents) {
        let pkg;
        try {
            pkg = JSON.parse(content);
        } catch {
            continue;
        }
        for (const field of DEP_FIELDS) {
            const deps = pkg[field];
            if (deps && typeof deps === 'object') {
                for (const name of Object.keys(deps)) names.add(name);
            }
        }
    }
    return names;
}

/**
 * Package names that appear on changed (`+`/`-`) lines of a unified
 * `pnpm-lock.yaml` diff. Matches `name@version` keys (scoped or not) from the
 * `packages:` / `snapshots:` sections, which change on any version bump. Biased
 * to over-match: an extra name only makes the gate run (fail-open), never skip.
 * @param {string} diff - `git diff … -- pnpm-lock.yaml` output.
 * @returns {Set<string>} Changed package names.
 */
export function changedLockfilePackages(diff) {
    const names = new Set();
    for (const line of diff.split('\n')) {
        const c = line[0];
        if ((c !== '+' && c !== '-') || line.startsWith('+++') || line.startsWith('---')) {
            continue;
        }
        for (const m of line.matchAll(/(@[a-z0-9][\w.-]*\/[\w.-]+|[a-z0-9][\w.-]*)@\d/gi)) {
            names.add(m[1]);
        }
    }
    return names;
}

/**
 * True if any changed lockfile package is a direct workspace dependency.
 * @param {Set<string>} changedPackages - Names from the lockfile diff.
 * @param {Set<string>} directDeps - Names declared across the workspace.
 * @returns {boolean} Whether the change can affect build/test/lint/type output.
 */
export function lockChangeIsCodeRelevant(changedPackages, directDeps) {
    for (const name of changedPackages) {
        if (directDeps.has(name)) return true;
    }
    return false;
}

/**
 * @param {string} ref - Git ref.
 * @returns {string} The lockfile diff between `ref` and the checkout, or '' on failure.
 */
function lockfileDiff(ref) {
    return execFileSync('git', ['diff', ref, '--', LOCKFILE], { encoding: 'utf8' });
}

/**
 * @returns {string[]} Contents of every tracked package.json (node_modules is
 *   untracked, so it is excluded automatically).
 */
function workspacePackageJsons() {
    const files = execFileSync('git', ['ls-files', '*package.json'], { encoding: 'utf8' })
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    return files.map(file => {
        try {
            return readFileSync(file, 'utf8');
        } catch {
            return '{}';
        }
    });
}

/**
 * @param {boolean} value - Result to publish.
 * @param {string} [reason] - Optional log note.
 */
function writeOutput(value, reason) {
    console.log(`[lock-gate] lock_code=${value}${reason ? ` (${reason})` : ''}`);
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `lock_code=${value}\n`);
    }
}

/** CI entry: write `lock_code=true|false` to `$GITHUB_OUTPUT`. */
function main() {
    const baseRef = process.env.BASE_REF;
    if (!baseRef || /^0+$/.test(baseRef)) {
        writeOutput(true, 'no usable base ref — failing open');
        return;
    }

    let diff;
    try {
        diff = lockfileDiff(baseRef);
    } catch {
        writeOutput(true, 'lockfile diff unavailable — failing open');
        return;
    }
    if (!diff.trim()) {
        writeOutput(false, 'lockfile unchanged');
        return;
    }

    const changed = changedLockfilePackages(diff);
    if (changed.size === 0) {
        // The lockfile changed in a way we could not attribute to packages
        // (settings, structure). Run, rather than guess.
        writeOutput(true, 'unparseable lockfile change — failing open');
        return;
    }

    let directDeps;
    try {
        directDeps = collectDirectDeps(workspacePackageJsons());
    } catch {
        writeOutput(true, 'could not read package.json files — failing open');
        return;
    }

    const relevant = lockChangeIsCodeRelevant(changed, directDeps);
    const hits = [...changed].filter(n => directDeps.has(n));
    console.log(
        relevant
            ? `[lock-gate] direct-dep change(s): ${hits.join(', ')}`
            : `[lock-gate] only transitive packages changed (${changed.size})`,
    );
    writeOutput(relevant);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main();
}
