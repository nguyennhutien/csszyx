#!/usr/bin/env node
// Ensure that the wasm-pack build artifacts (pkg/ + pkg-node/) exist.
//
// Why: pkg/ and pkg-node/ are gitignored. They live only in the npm tarball
// (shipped via the `files` field) and on the local machine after build.
// In the dev workflow Turbo's `^build` dependency chain regenerates them
// when consumers run `pnpm build` / `pnpm test` at the workspace root, so a
// `prepare` hook is intentionally NOT wired up — that path used to crash
// devcontainers under Docker (full LTO Rust compile competing with parallel
// pnpm install hooks for RAM). This script is a publish-time gate only.
//
// Entry points:
//
//   1. `npm run prepublishOnly`    — `--strict`. Always rebuilds (never
//      trusts stale artifacts) and aborts publish if any expected output
//      file is missing afterwards.
//
//   2. Manual ad-hoc run           — `node scripts/ensure-build.mjs`.
//      Idempotent: builds only when artifacts are missing; no-op otherwise.
//
// Defense in depth: bails if Cargo.toml is missing (e.g. running from inside
// a consumer's node_modules instead of the source repo).

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');

const REQUIRED_FILES = [
    'pkg/csszyx_core.js',
    'pkg/csszyx_core.d.ts',
    'pkg/csszyx_core_bg.wasm',
    'pkg-node/csszyx_core.js',
    'pkg-node/csszyx_core.d.ts',
    'pkg-node/csszyx_core_bg.wasm',
];

const strict = process.argv.includes('--strict');

// Defense-in-depth: this script lives in `packages/core/scripts/` of the
// SOURCE repo. If Cargo.toml is missing, we're being run from somewhere
// unexpected (e.g. inside a consumer's node_modules) — bail safely.
if (!existsSync(path.join(pkgDir, 'Cargo.toml'))) {
    console.log('[ensure-build] No Cargo.toml found — skipping (not a source build).');
    process.exit(0);
}

/**
 * Return paths of any required artifacts that are missing.
 * @returns {string[]} List of missing file paths (relative to pkgDir).
 */
function missingArtifacts() {
    return REQUIRED_FILES.filter(f => !existsSync(path.join(pkgDir, f)));
}

const missing = missingArtifacts();
const needsBuild = strict || missing.length > 0;

if (!needsBuild) {
    console.log('[ensure-build] Artifacts present — skipping rebuild.');
    process.exit(0);
}

if (missing.length > 0) {
    console.log(`[ensure-build] Missing ${missing.length} artifact(s). Running build...`);
} else {
    console.log('[ensure-build] --strict mode: rebuilding artifacts...');
}

try {
    execSync('npm run build', { cwd: pkgDir, stdio: 'inherit' });
} catch {
    console.error('[ensure-build] Build failed.');
    process.exit(1);
}

const stillMissing = missingArtifacts();
if (stillMissing.length > 0) {
    console.error('[ensure-build] Build completed but expected files are still missing:');
    for (const f of stillMissing) { console.error(`  - ${f}`); }
    process.exit(1);
}

console.log('[ensure-build] Build successful — all artifacts present.');
