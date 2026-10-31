#!/usr/bin/env node
// Post-process WASM outputs with wasm-opt if binaryen is available.
//
// wasm-pack's built-in wasm-opt pass is disabled via Cargo.toml metadata to
// avoid a flaky auto-download of binaryen from GitHub Releases. This script
// re-introduces the size pass as a build-script post-step so that turbo's
// cache captures the OPTIMIZED pkg-parser/ output (running wasm-opt outside the
// cached build step would be overwritten on the next turbo cache hit).
//
// Environments:
//   - Release workflow installs binaryen via apt → wasm-opt runs, pkg-parser/ ships
//     fully optimized to npm.
//   - CI/dev environments typically have no binaryen → script skips with a
//     visible log line. This is fine: size optimization is only required for
//     the published npm artifact.
//   - `CSSZYX_REQUIRE_WASM_OPT=1` (the release workflow) turns the skip into a
//     failure, so the bytes the release tests are the bytes it publishes.
//
// The optimized module is written once with its name section (`-g`) to
// `pkg-parser-debug/`, which npm does not ship and the release attaches to the
// GitHub release, then stripped of it without optimizing again, so every
// function index in a published stack trace (`wasm-function[N]`) names the
// same function in the debug file.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');
const debugDir = path.join(pkgDir, 'pkg-parser-debug');

// A debug wasm left by an earlier build would sit beside this build's wasm,
// and be cached with it, without naming its functions.
rmSync(debugDir, { recursive: true, force: true });

const probe = spawnSync('wasm-opt', ['--version'], { stdio: 'ignore' });
if (probe.status !== 0 && process.env.CSSZYX_REQUIRE_WASM_OPT === '1') {
    console.error('[wasm-opt] binary not found on PATH, and CSSZYX_REQUIRE_WASM_OPT=1 requires it.');
    process.exit(1);
}
if (probe.status !== 0) {
    console.log('[wasm-opt] binary not found on PATH — skipping size optimization.');
    console.log('[wasm-opt] Expected in CI/dev. Release workflow installs binaryen via apt.');
    process.exit(0);
}

const targets = [
    path.join(pkgDir, 'pkg-parser', 'csszyx_core_bg.wasm'),
];

for (const wasm of targets) {
    if (!existsSync(wasm)) {
        console.warn(`[wasm-opt] missing, skipping: ${path.relative(pkgDir, wasm)}`);
        continue;
    }
    // Write to a sibling .tmp then atomically rename, so a crash mid-run
    // cannot leave a partially-written WASM in place.
    const tmp = `${wasm}.tmp`;
    const debug = path.join(debugDir, path.basename(wasm).replace(/\.wasm$/, '.debug.wasm'));
    mkdirSync(debugDir, { recursive: true });
    console.log(`[wasm-opt] optimizing ${path.relative(pkgDir, wasm)}`);
    execFileSync('wasm-opt', ['-O', '-g', wasm, '-o', debug], { stdio: 'inherit' });
    execFileSync('wasm-opt', ['--strip-debug', '--strip-producers', debug, '-o', tmp], {
        stdio: 'inherit',
    });
    renameSync(tmp, wasm);
}

console.log('[wasm-opt] done.');
