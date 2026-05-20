#!/usr/bin/env node
// Tripwire validation for release-please configuration.
//
// Runs on every CI build (no path filter) so config-only commits — even
// the ones path filters or commit types would otherwise skip — still get
// a sanity check before they can break a release. Catches:
//   - JSON syntax errors in release-please-config.json or
//     .release-please-manifest.json.
//   - Manifest entries that don't correspond to a component declared in
//     the config (or vice-versa).
//   - Component paths that point at a non-existent package.json (e.g.
//     someone removed packages/foo without updating the config).
//   - exclude-paths entries with suspicious path syntax (.. traversal
//     or absolute paths) — release-please rejects these at runtime.
//   - Native platform package manifests missing from root extra-files.
//
// Run locally:    node .github/scripts/validate-release-please-config.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { NATIVE_PLATFORM_PACKAGES } from '../../packages/core/native/platforms.js';

const root = process.cwd();
let errors = 0;

function error(msg) {
    console.error(`::error::${msg}`);
    errors++;
}

function readJson(path) {
    const full = resolve(root, path);
    if (!existsSync(full)) {
        error(`${path} is missing`);
        return null;
    }
    try {
        return JSON.parse(readFileSync(full, 'utf8'));
    } catch (e) {
        error(`${path} is not valid JSON: ${e.message}`);
        return null;
    }
}

const config = readJson('release-please-config.json');
const manifest = readJson('.release-please-manifest.json');

if (config && manifest) {
    const componentPaths = Object.keys(config.packages || {});

    if (componentPaths.length === 0) {
        error('release-please-config.json has no entries under "packages"');
    }

    // Manifest <-> config consistency.
    for (const path of componentPaths) {
        if (!(path in manifest)) {
            error(`manifest is missing an entry for component "${path}" declared in release-please-config.json`);
        }
    }
    for (const path of Object.keys(manifest)) {
        if (!(path in (config.packages || {}))) {
            error(`manifest has an entry for "${path}" that is not declared in release-please-config.json`);
        }
    }

    // Component path actually points at something publishable.
    for (const path of componentPaths) {
        if (path === '.') {
            // Root component reads version from root package.json. Existence is
            // guaranteed at the repo level — skip.
            continue;
        }
        const pkgJson = join(path, 'package.json');
        if (!existsSync(resolve(root, pkgJson))) {
            error(`component "${path}" is declared in config but ${pkgJson} doesn't exist`);
        }
    }

    // exclude-paths sanity (release-please rejects ".." and absolute paths at
    // runtime — catch them here instead of at release time).
    const excludePaths = config['exclude-paths'] || [];
    for (const path of excludePaths) {
        if (typeof path !== 'string') {
            error(`exclude-paths entry is not a string: ${JSON.stringify(path)}`);
            continue;
        }
        if (path.includes('..')) {
            error(`exclude-paths entry "${path}" contains ".." — release-please will reject at runtime with "illegal pathing characters"`);
        }
        if (path.startsWith('/')) {
            error(`exclude-paths entry "${path}" is absolute — must be repo-relative`);
        }
    }

    const rootPackage = config.packages?.['.'];
    const extraFiles = new Set(rootPackage?.['extra-files'] ?? []);
    for (const packageInfo of NATIVE_PLATFORM_PACKAGES) {
        const packageJsonPath = `${packageInfo.dir}/package.json`;
        if (!extraFiles.has(packageJsonPath)) {
            error(`root extra-files is missing native package manifest "${packageJsonPath}"`);
        }
    }
}

if (errors > 0) {
    console.error(`\n${errors} validation error(s)`);
    process.exit(1);
}

console.log('release-please config + manifest are consistent.');
console.log(`  components: ${Object.keys(config.packages || {}).length}`);
console.log(`  manifest entries: ${Object.keys(manifest).length}`);
console.log(`  exclude-paths: ${(config['exclude-paths'] || []).length}`);
