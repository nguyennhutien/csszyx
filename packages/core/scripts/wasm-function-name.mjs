#!/usr/bin/env node
// The Rust function a `wasm-function[N]` in a stack trace names.
//
// The published engine module carries no function names; each GitHub release
// has `csszyx_core_bg.debug.wasm`, the same module with its name section kept
// (scripts/run-wasm-opt.mjs). The name section counts functions as the stack
// trace does, imports included, so N reads back directly.
//
// Usage: node scripts/wasm-function-name.mjs <debug.wasm> <N> [N...]

import { readFileSync } from 'node:fs';

const [file, ...wanted] = process.argv.slice(2);
if (!file || wanted.length === 0) {
    console.error('usage: node scripts/wasm-function-name.mjs <debug.wasm> <N> [N...]');
    process.exit(1);
}
const indexes = new Set(wanted.map(Number));
const bytes = readFileSync(file);
let at = 8;

/** @returns {number} The unsigned LEB128 number at `at`, which it moves past. */
function leb() {
    let value = 0;
    let shift = 0;
    let byte;
    do {
        byte = bytes[at++];
        value |= (byte & 127) << shift;
        shift += 7;
    } while (byte & 128);
    return value >>> 0;
}

/** @returns {string} The length-prefixed name at `at`, which it moves past. */
function name() {
    const length = leb();
    at += length;
    return bytes.toString('utf8', at - length, at);
}

const found = new Set();
while (at < bytes.length) {
    const id = bytes[at++];
    const end = leb() + at;
    if (id === 0 && name() === 'name') {
        while (at < end) {
            const subsection = bytes[at++];
            const next = leb() + at;
            // Subsection 1 lists each function's index and name.
            for (let count = subsection === 1 ? leb() : 0; count > 0; count--) {
                const index = leb();
                const functionName = name();
                if (indexes.has(index)) {
                    console.log(`wasm-function[${index}] ${functionName}`);
                    found.add(index);
                }
            }
            at = next;
        }
    }
    at = end;
}
// A number with no name means the file is not the module that printed the
// trace, or the number is not a function's.
const missing = [...indexes].filter(index => !found.has(index));
if (missing.length > 0) {
    console.error(`no function name for ${missing.join(', ')} in ${file}`);
    process.exitCode = 1;
}
