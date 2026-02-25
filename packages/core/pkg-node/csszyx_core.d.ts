/* tslint:disable */
/* eslint-disable */

/**
 * WASM bindings for JavaScript interop
 */
export class WasmCollisionDetector {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds a CSS value and returns its variable name (WASM binding).
     *
     * # Arguments
     *
     * * `value` - CSS value to hash
     *
     * # Returns
     *
     * Variable name (e.g., "--v-abc123" or "--v-abc123-def456")
     */
    add(value: string): string;
    /**
     * Gets the total number of variables (WASM binding).
     *
     * # Returns
     *
     * Number of unique CSS values
     */
    count(): number;
    /**
     * Checks if any collision occurred (WASM binding).
     *
     * # Returns
     *
     * `true` if collision detected
     */
    has_collision(): boolean;
    /**
     * Creates a new collision detector (WASM binding).
     */
    constructor();
}

/**
 * Computes a deterministic SHA-256 checksum for a mangle map.
 *
 * The checksum is designed to be:
 * 1. **Deterministic**: Same map always produces same checksum
 * 2. **Collision-resistant**: Different maps produce different checksums
 * 3. **Compact**: 16-character hex string (64 bits of SHA-256)
 *
 * # Algorithm
 *
 * 1. Sort all entries by original class name (determinism)
 * 2. Create canonical string: "orig1:mangle1|orig2:mangle2|..."
 * 3. Compute SHA-256 hash
 * 4. Take first 16 hex characters (64 bits, ~1.8e19 possible values)
 *
 * # Arguments
 *
 * * `map` - The mangle map to checksum
 *
 * # Returns
 *
 * A 16-character hex string checksum
 *
 * # Performance
 *
 * - Time complexity: O(n log n) for sorting + O(n) for hashing
 * - Space complexity: O(n) for canonical string
 * - Typical runtime: ~10-50µs for 1000 entries (10-15x faster than JS)
 *
 * # Security
 *
 * While we only use 64 bits of SHA-256, this provides sufficient collision
 * resistance for our use case (detecting accidental mismatches, not
 * cryptographic attacks). Birthday paradox gives us ~4 billion hashes
 * before 50% collision probability.
 *
 * # Examples
 *
 * ```ignore
 * // This function is wasm_bindgen — call from JS, not Rust directly.
 * // Use compute_checksum_internal() for pure-Rust usage.
 * let checksum = compute_mangle_checksum(js_map);
 * ```
 */
export function compute_mangle_checksum(map: any): string;

/**
 * Encodes an index to a reversed tier-based Base62 string.
 *
 * # Arguments
 *
 * * `index` - The zero-based index to encode
 *
 * # Returns
 *
 * A Base62 encoded string following tier-based rules with reversed sequence
 *
 * # Performance
 *
 * - Time complexity: O(log n)
 * - Space complexity: O(log n)
 * - Average: ~5ns per encoding (measured on x86_64)
 *
 * # Examples
 *
 * ```
 * use csszyx_core::encoder::encode;
 *
 * // Tier 1: Single letters (reversed)
 * assert_eq!(encode(0), "z");
 * assert_eq!(encode(25), "a");
 * assert_eq!(encode(26), "Z");
 * assert_eq!(encode(51), "A");
 *
 * // Tier 2: Letter + digit (both reversed)
 * assert_eq!(encode(52), "z9");
 * assert_eq!(encode(53), "z8");
 * assert_eq!(encode(571), "A0");
 *
 * // Tier 3: Two letters (both reversed)
 * assert_eq!(encode(572), "zz");
 * assert_eq!(encode(573), "zy");
 * ```
 */
export function encode(index: number): string;

/**
 * Generates a cryptographic token for a recovery declaration.
 *
 * # Arguments
 *
 * * `component` - Component name
 * * `path` - Absolute file path
 * * `line` - Line number in source
 * * `column` - Column number in source
 * * `mode` - Recovery mode ('csr' or 'dev-only')
 * * `build_id` - Build identifier (git hash or timestamp)
 *
 * # Returns
 *
 * A 12-character Base62 encoded token (first 12 chars of SHA-256 hash)
 *
 * # Security
 *
 * - Uses SHA-256 for cryptographic strength
 * - Includes source location for uniqueness
 * - Build ID ensures different builds have different tokens
 * - Base62 encoding for URL safety
 *
 * # Examples
 *
 * ```
 * use csszyx_core::token::generate_token;
 *
 * let token = generate_token(
 *     "DataTable",
 *     "/src/components/DataTable.tsx",
 *     42,
 *     8,
 *     "csr",
 *     "abc123def456"
 * );
 *
 * assert_eq!(token.len(), 12);
 * ```
 */
export function generate_token(component: string, path: string, line: number, column: number, mode: string, build_id: string): string;

/**
 * Initializes the WASM module.
 *
 * Should be called once before using any functions.
 *
 * # Examples
 *
 * ```javascript
 * import init, { encode } from 'csszyx-core';
 *
 * await init();
 * const id = encode(42);
 * ```
 */
export function init(): void;

/**
 * Transforms a csszyx sz object into a Tailwind CSS className string in Rust for maximum performance.
 *
 * Phase 3 Enhancements:
 * - Handles nested variants (hover, focus, md, etc.)
 * - Handles negative values (m: -4 -> -m-4)
 * - Handles boolean flags
 */
export function transform_sz(val: any): string;

/**
 * WASM-exposed checksum verification.
 *
 * # Arguments
 *
 * * `map` - JavaScript object representing the mangle map
 * * `expected_checksum` - The expected checksum string
 *
 * # Returns
 *
 * `true` if checksum matches, `false` otherwise
 */
export function verify_mangle_checksum(map: any, expected_checksum: string): boolean;

/**
 * Verifies a token against component information.
 *
 * # Arguments
 *
 * * `token` - Token to verify
 * * `component` - Component name
 * * `path` - File path
 * * `line` - Line number
 * * `column` - Column number
 * * `mode` - Recovery mode
 * * `build_id` - Build identifier
 *
 * # Returns
 *
 * `true` if token matches, `false` otherwise
 */
export function verify_token(token: string, component: string, path: string, line: number, column: number, mode: string, build_id: string): boolean;

/**
 * Gets the version of csszyx-core.
 *
 * # Returns
 *
 * Version string
 */
export function version(): string;
