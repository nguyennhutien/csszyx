#!/usr/bin/env node
/**
 * Decide whether the VS Code extension changed enough to warrant a Marketplace
 * publish. release-please bumps `packages/vscode/package.json` on EVERY release
 * (it is an extra-file), so a naive path check always reports a change. This
 * treats a version-only package.json bump as "unchanged" and reports a real
 * change only when extension source, assets, or any other package.json field
 * moved.
 *
 * Usage: node scripts/vscode-extension-changed.mjs [baseRef] [headRef]
 *   baseRef  previous release point (default: nearest tag before headRef^)
 *   headRef  release commit/tag (default: HEAD)
 * Prints "true" or "false" on stdout. Fails open to "true" (publish) whenever
 * the base cannot be resolved, so a detection gap never silently drops a real
 * extension release.
 */
import { execFileSync } from 'node:child_process';

const DIR = 'packages/vscode';
const PKG = `${DIR}/package.json`;

function git(args) {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function tryGit(args) {
    try {
        return git(args);
    } catch {
        return '';
    }
}

const headRef = process.argv[3] || 'HEAD';
let baseRef = process.argv[2] || '';

if (!baseRef) {
    // Nearest tag strictly before the head commit — the previous release.
    baseRef = tryGit(['describe', '--tags', '--abbrev=0', `${headRef}^`]);
}

if (!baseRef || !tryGit(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`])) {
    // No prior release to diff against, or the base ref does not resolve — fail
    // open to a publish so a detection gap never silently drops a real release.
    console.log('true');
    process.exit(0);
}

const changedFiles = tryGit(['diff', '--name-only', `${baseRef}..${headRef}`, '--', DIR])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

if (changedFiles.length === 0) {
    console.log('false');
    process.exit(0);
}

const nonPkgChange = changedFiles.some(file => file !== PKG);
if (nonPkgChange) {
    console.log('true');
    process.exit(0);
}

// Only package.json moved — treat a version-only bump as no change.
function pkgWithoutVersion(ref) {
    const raw = tryGit(['show', `${ref}:${PKG}`]);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        delete parsed.version;
        return JSON.stringify(parsed);
    } catch {
        return raw;
    }
}

const before = pkgWithoutVersion(baseRef);
const after = pkgWithoutVersion(headRef);
console.log(before !== after ? 'true' : 'false');
