// Shared helpers for generators that write Rust source from TypeScript tables.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Render a string as a Rust string literal.
 *
 * JSON escaping is valid Rust for every value these tables hold: the only
 * characters that need escaping are quotes and backslashes, which both
 * languages spell the same way.
 *
 * @param {string} value - The text to quote.
 * @returns {string} A double-quoted Rust literal.
 */
export function rustString(value) {
    return JSON.stringify(value);
}

/**
 * Run rustfmt over generated Rust source, so the checked-in file is what
 * `cargo fmt --check` expects and a regenerate never shows a formatting diff.
 *
 * @param {string} rustSource - Unformatted Rust source.
 * @param {string} label - Generator name for the error message.
 * @returns {string} The formatted source.
 */
export function formatRust(rustSource, label) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'csszyx-rust-gen-'));
    const tempPath = path.join(tempDir, 'generated.rs');

    try {
        writeFileSync(tempPath, rustSource);
        const result = spawnSync('rustfmt', [tempPath], { encoding: 'utf8' });
        if (result.status !== 0) {
            console.error(result.stderr);
            throw new Error(`[${label}] rustfmt failed for generated Rust source`);
        }

        return readFileSync(tempPath, 'utf8');
    } finally {
        rmSync(tempDir, { force: true, recursive: true });
    }
}
