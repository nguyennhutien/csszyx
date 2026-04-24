#!/usr/bin/env node
// Verify wasm-bindgen-cli is installed before wasm-pack runs.
//
// We invoke wasm-pack with `--mode no-install` (see package.json `build`),
// which skips wasm-pack's auto-install of wasm-bindgen. The auto-install
// path has a parse bug on repeat invocations (see fix in commit f9a5285),
// so CI + build scripts pre-install wasm-bindgen-cli via cargo. This
// preflight turns the otherwise cryptic wasm-pack error
//   "Not able to find or install a local wasm-bindgen"
// into an actionable instruction for developers running `pnpm build`
// on a fresh host (e.g. macOS without cargo install yet).
//
// Also verifies the version matches the pin in Cargo.toml — wasm-bindgen
// refuses to load a module when the CLI version differs from the crate
// version used at compile time, and that error is even less obvious.

import { spawnSync } from 'node:child_process';

const EXPECTED_VERSION = '0.2.93';
const INSTALL_CMD = `cargo install wasm-bindgen-cli --locked --version ${EXPECTED_VERSION}`;

/**
 * Print an error block and exit with code 1.
 * @param {string[]} lines - Lines to print to stderr.
 * @returns {never}
 */
function fail(lines) {
    const bar = '─'.repeat(64);
    console.error(`\n${bar}`);
    for (const line of lines) {
        console.error(line);
    }
    console.error(`${bar}\n`);
    process.exit(1);
}

const probe = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' });

if (probe.status !== 0) {
    fail([
        '[preflight] wasm-bindgen-cli is not on PATH.',
        '',
        '@csszyx/core builds with `wasm-pack --mode no-install`, which',
        'skips wasm-pack\'s auto-install of wasm-bindgen. Install it once:',
        '',
        `  ${INSTALL_CMD}`,
        '',
        'Docs: https://rustwasm.github.io/docs/wasm-pack/commands/build.html',
    ]);
}

// `wasm-bindgen --version` prints e.g. "wasm-bindgen 0.2.93"
const match = probe.stdout.trim().match(/wasm-bindgen\s+(\S+)/);
const actual = match ? match[1] : probe.stdout.trim();

if (actual !== EXPECTED_VERSION) {
    fail([
        `[preflight] wasm-bindgen-cli version mismatch: found ${actual}, expected ${EXPECTED_VERSION}.`,
        '',
        'The CLI version must match the `wasm-bindgen` pin in',
        'packages/core/Cargo.toml — otherwise the generated module fails',
        'to load with a signature-mismatch error at runtime.',
        '',
        'Reinstall the pinned version:',
        '',
        `  ${INSTALL_CMD}`,
    ]);
}
