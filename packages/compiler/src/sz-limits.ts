/**
 * Shared limits that bound how much work a single sz object can force.
 *
 * sz objects can come from untrusted runtime data (e.g. a JSON-driven UI), and
 * the transform / merge helpers recurse over nested variant objects. Without a
 * bound, a deeply nested object (`{hover:{hover:{…}}}`) overflows the call stack
 * — a denial-of-service that is reachable at request time, not just at build.
 * These limits convert that crash into a catchable, typed error.
 *
 * Kept dependency-free so both the compiler and the runtime can import it.
 */

/**
 * Maximum nesting depth for an sz object / array before processing aborts.
 * Far above real usage — authored sz nests only a few levels (a variant chain
 * like `dark:{ hover:{ md:{…} } }` is ~3-4), so legitimate input never hits it.
 */
export const MAX_SZ_DEPTH = 32;

/**
 * Thrown when an sz object/array nests deeper than {@link MAX_SZ_DEPTH}. A typed
 * error so callers can distinguish a hostile-input limit from a real bug, and so
 * the build pipeline's per-file fallback can swallow it without a stack overflow.
 */
export class SzDepthError extends Error {
    /**
     * @param depth - the depth limit that was exceeded (for the message).
     */
    constructor(depth: number = MAX_SZ_DEPTH) {
        super(
            `[csszyx] sz nesting exceeded the maximum depth of ${depth}. ` +
                'This usually means untrusted/looping data reached an sz prop.',
        );
        this.name = 'SzDepthError';
    }
}

/**
 * Keys that must never be written through a computed `obj[key] = …` on data that
 * may be `JSON.parse`d: assigning to `__proto__`/`constructor`/`prototype`
 * pollutes `Object.prototype` for the whole process. (Literal keys in source are
 * inert; the risk is request-time JSON whose own enumerable `__proto__` key is
 * copied during a merge.)
 *
 * @param key - the property key about to be written.
 * @returns true when the key is unsafe to assign and should be skipped.
 */
export function isForbiddenSzKey(key: string): boolean {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
