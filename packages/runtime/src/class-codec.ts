/**
 * The runtime mangle codec, shared by every helper that reads class names.
 *
 * `szcn` decoded through the registry from the day mangling shipped; the
 * class toolkit (`has`, `splitBox` and friends) did not, while its
 * documentation said it did. One reader and one decode/encode pair here, so
 * the two families can never disagree about what a token means.
 *
 * @module
 */
import { getMangleRegistry } from './mangle-registry.js';

/** The runtime mangle bridge: the registry, or the legacy inline-script object. */
export interface MangleBridge {
    decode?: (c: string) => string | undefined;
    mangleMap?: Readonly<Record<string, string>>;
}

/**
 * Read the installed runtime bridge ONCE per merge. `_szcn` runs unmemoized
 * per element in list renders, so per-token global reads are the hot cost
 * here — every token needs both the decode bridge (conflict classification)
 * and the encode map (output form), and one read serves both.
 *
 * The registry the bundled module installs comes first; `globalThis.__csszyx`
 * is the object the deprecated inline HTML installer assigns and stays
 * readable for one migration window.
 *
 * @returns The installed bridge object, or undefined.
 */
export function mangleBridge(): MangleBridge | undefined {
    return getMangleRegistry() ?? (globalThis as { __csszyx?: MangleBridge }).__csszyx;
}

/**
 * Resolve a token to its original (un-mangled) name using the runtime reverse
 * mangle map when present. No map (dev / unmangled build) → token is already
 * original.
 *
 * @param token - A class token, possibly mangled.
 * @param bridge - The runtime bridge read once by the caller.
 * @returns The original class name.
 */
export function decodeToken(token: string, bridge: MangleBridge | undefined): string {
    const decode = bridge?.decode;
    if (typeof decode === 'function') {
        // The decode map is external (an inline script sets it). A buggy or
        // mid-update map that throws, or returns a non-string, must NEVER break
        // the merge — szcn is the leaf of every layered component, so a crash here
        // is a blank render. Fall back to the raw token (still valid; it just
        // won't be mangle-grouped, same as the no-map path). Fail-safe over clever.
        try {
            const decoded = decode(token);
            return typeof decoded === 'string' ? decoded : token;
        } catch {
            return token;
        }
    }
    return token;
}

/**
 * Encode one token through the runtime mangle map when present.
 *
 * A string that is a map KEY is always an original class name — the build
 * reserves every census name from the token allocator, so a mangled token can
 * never collide with a key — which makes this a single unambiguous, idempotent
 * lookup: originals of mangled classes encode to their token; already-mangled
 * tokens, authored classes, and external names pass through unchanged.
 *
 * This is what heals a class RESOLVED AT RUNTIME as a plain string (a
 * component mapping a prop to a class name and merging it at its leaf): the
 * CSS ships mangled, so the string must reach the DOM mangled too.
 *
 * The `typeof` guard is not decorative: a plain-object map inherits
 * `Object.prototype`, so a hostile or unlucky token (`constructor`,
 * `hasOwnProperty`) resolves to a function up the prototype chain and must
 * pass through as itself, never be stringified into the output.
 *
 * @param token - A class token, possibly an original censused name.
 * @param bridge - The runtime bridge read once by the caller.
 * @returns The mangled token when the map covers it, otherwise the token.
 */
export function encodeToken(token: string, bridge: MangleBridge | undefined): string {
    const map = bridge?.mangleMap;
    if (!map) {
        return token;
    }
    // Same fail-safe stance as decodeToken: an exotic host object must never
    // break the merge.
    try {
        const encoded = map[token];
        return typeof encoded === 'string' ? encoded : token;
    } catch {
        return token;
    }
}
