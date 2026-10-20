/**
 * The mangle checksum recomputed in the browser, byte-for-byte what the Rust
 * core derives. Its own module so a suite outside the runtime (the core's
 * checksum parity test) can load it from source with nothing else the
 * hydration guard imports.
 *
 * @module
 */

import type { MangleMap } from './hydration.js';

/**
 * Why Web Crypto cannot be used here, or null when it can.
 *
 * `crypto.subtle` exists only in a secure context, so a page served over plain
 * HTTP from anything but localhost does not have it. Both the compute and the
 * verify path need this answer and both need to say the same thing about it,
 * so the sentence lives here once.
 *
 * @returns the reason, or null when Web Crypto is available.
 */
export function webCryptoUnavailable(): string | null {
    if (typeof crypto === 'undefined' || crypto.subtle === undefined) {
        return (
            '[csszyx] web-crypto-unavailable: Web Crypto is unavailable, so the mangle checksum cannot be recomputed. ' +
            'crypto.subtle exists only in a secure context: serve the page over HTTPS, or ' +
            'from localhost. Nothing was verified.'
        );
    }
    return null;
}

/**
 * Order two byte sequences the way Rust orders the strings they encode.
 *
 * @param a - left operand.
 * @param b - right operand.
 * @returns negative, zero or positive, for `Array.prototype.sort`.
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
        const left = a[i] as number;
        const right = b[i] as number;
        if (left !== right) return left - right;
    }
    return a.length - b.length;
}

/**
 * Recompute a mangle map's checksum the same way the Rust core does
 * (`compute_checksum_internal`): SHA-256 over the entries sorted by key and
 * formatted `<origLen>:<orig>:<mangleLen>:<mangle>`, joined by `|`, hex-encoded,
 * first 16 chars (64 bits). The lengths count UTF-16 code units.
 *
 * Uses the Web Crypto API (`crypto.subtle`), so it works WITHOUT the WASM core —
 * unlike the WASM-only sync path. Async because `crypto.subtle.digest` is async.
 *
 * @param map - the mangle map to checksum.
 * @returns the 16-char hex checksum, byte-for-byte what the Rust core derives
 *          from the same map, whatever characters the class names carry.
 * @throws when Web Crypto is unavailable, which means an insecure context.
 */
export async function computeMangleChecksumAsync(map: MangleMap): Promise<string> {
    const unavailable = webCryptoUnavailable();
    if (unavailable !== null) {
        throw new Error(unavailable);
    }
    // Sort by the bytes that get hashed, which is what the Rust core compares.
    // Comparing the strings instead is a tenth of a millisecond cheaper on a
    // five-hundred-name map and wrong: JavaScript would order the text it holds
    // while the core orders the text it received, and an unpaired surrogate
    // survives the first and not the second. Encoding once per name settles it
    // without anyone having to reason about surrogates.
    //
    // The shape carries a length per field. See the core's
    // compute_checksum_internal: a name holding the separator — every variant
    // class holds a colon — would otherwise let two different maps render the
    // same text and share a checksum.
    const encoder = new TextEncoder();
    const canonical = Object.keys(map)
        .map(key => ({ key, bytes: encoder.encode(key) }))
        .sort((a, b) => compareBytes(a.bytes, b.bytes))
        .map(({ key }) => {
            const value = map[key] as string;
            return `${key.length}:${key}:${value.length}:${value}`;
        })
        .join('|');
    const bytes = encoder.encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    let hex = '';
    for (const b of new Uint8Array(digest)) {
        hex += b.toString(16).padStart(2, '0');
    }
    return hex.slice(0, 16);
}
