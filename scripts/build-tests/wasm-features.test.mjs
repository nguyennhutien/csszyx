/**
 * The engine's wasm build keeps the `target_features` section rustc writes.
 *
 * wasm-opt reads that section to learn which instructions the module may use
 * (bulk memory, sign extension, reference types, ...). Without it wasm-opt
 * assumes the 1.0 instruction set and refuses the module: binaryen 105 and
 * 132 both stop with `error validating input`. CI has no wasm-opt, so the
 * release, the only build that runs it, was the first to find out — a
 * `strip = "symbols"` in the shared release profile removed the section.
 *
 * Reads the built package and FAILS when it is not built.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const WASM = path.resolve(
    import.meta.dirname,
    '../../packages/core/pkg-parser/csszyx_core_bg.wasm',
);

/**
 * Read an unsigned LEB128 integer.
 *
 * @param {Uint8Array} bytes - The module.
 * @param {number} at - Where the integer starts.
 * @returns {[number, number]} The value, and the offset after it.
 */
function leb(bytes, at) {
    let value = 0;
    let shift = 0;
    let byte;
    do {
        byte = bytes[at++];
        value += (byte & 0x7f) * 2 ** shift;
        shift += 7;
    } while (byte & 0x80);
    return [value, at];
}

/**
 * The names of a module's custom sections, in order.
 *
 * @param {Uint8Array} bytes - The module.
 * @returns {string[]} The names.
 */
function customSections(bytes) {
    const names = [];
    let at = 8;
    while (at < bytes.length) {
        const id = bytes[at++];
        const [size, body] = leb(bytes, at);
        if (id === 0) {
            const [length, name] = leb(bytes, body);
            names.push(Buffer.from(bytes.subarray(name, name + length)).toString('utf8'));
        }
        at = body + size;
    }
    return names;
}

test('the engine wasm carries the target_features section wasm-opt reads', () => {
    assert.ok(existsSync(WASM), 'build packages/core first');
    assert.ok(customSections(readFileSync(WASM)).includes('target_features'));
});
