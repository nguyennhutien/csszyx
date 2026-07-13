import { bench, describe } from 'vitest';
import { compute_mangle_checksum, init } from '../pkg-node/csszyx_core.js';

/**
 * A simple, pure JavaScript implementation of a hashing-like operation
 * to simulate the CPU-intensive work WASM handles.
 * This simulates the sorting, string joining, and hashing overhead.
 */
function computeChecksumPureJS(map: Record<string, string>): string {
    const sortedKeys = Object.keys(map).sort((a, b) => a.localeCompare(b));
    const result = sortedKeys.map(key => `${key}:${map[key]}|`).join('');

    return hashString(result);
}

function hashString(value: string): string {
    // Simulate complex hashing logic (like SHA-256) in pure JS
    // without using native C++ modules like node:crypto.
    let h = 0;
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        // The outer imul coerces the accumulated sum back to signed int32.
        h = Math.imul(Math.imul(31, h) + codePoint, 1);
    }
    return h.toString(16).padStart(16, '0');
}

/**
 * Generates test data.
 */
function createTestMap(count: number): Record<string, string> {
    const map: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
        map[`class-name-with-some-length-${i}`] = `m-${i}`;
    }
    return map;
}

describe('Mangle Checksum Performance: WASM vs Pure JS', () => {
    init();

    const sizes = [1000, 5000];

    for (const size of sizes) {
        const testMap = createTestMap(size);

        describe(`Input Size: ${size} entries`, () => {
            bench('Rust (WASM Core)', () => {
                compute_mangle_checksum(testMap);
            });

            bench('Pure JavaScript (Interpreted)', () => {
                computeChecksumPureJS(testMap);
            });
        });
    }
});
