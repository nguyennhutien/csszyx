/**
 * Shared limits that bound how much work a single sz object can force.
 *
 * sz objects can come from untrusted runtime data (e.g. a JSON-driven UI), and
 * the transform / merge helpers recurse over nested variant objects. Without a
 * bound, a deeply nested object (`{hover:{hover:{…}}}`) overflows the call stack
 * — a denial-of-service that is reachable at request time, not just at build.
 * These limits convert that crash into a catchable, typed error.
 *
 * Kept free of the compiler's tables so both the compiler and the runtime can
 * import it: it imports the error class, and the development reporter that
 * words the error, which an app's production build drops.
 */

import { CsszyxError } from './errors.js';
import { SZ_OBJECT_DEPTH, szRender } from './report.js';

/**
 * Where a class list splits: a run of Unicode White_Space, where the engine
 * splits one (`split_whitespace`), so a list reads the same at build and at
 * run time. JavaScript's `\s` also holds a BOM, which is not White_Space: the
 * engine keeps a BOM inside a class, and a split on `\s` cuts that class in
 * two. Here because every entry that reads a class list (the runtime's `core`
 * and `merge`, the build plugin) already loads this module.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export const CLASS_LIST_SPACE: RegExp = /\p{White_Space}+/u;

/**
 * Where a browser splits a `class` attribute: a run of ASCII whitespace (tab,
 * line feed, form feed, carriage return, space). For a string that goes into
 * the DOM as written: any other character, an NBSP or a NEL, joins two names
 * into one class, so a pass that rewrites such a string in production splits
 * it here, or production reads a class list dev never had. A string csszyx
 * merges splits on {@link CLASS_LIST_SPACE}, as the runtime merges it.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export const HTML_CLASS_SPACE: RegExp = /[\t\n\f\r ]+/;

/**
 * Maximum nesting depth for an sz object / array before processing aborts.
 * Far above real usage — authored sz nests only a few levels (a variant chain
 * like `dark:{ hover:{ md:{…} } }` is ~3-4), so legitimate input never hits it.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export const MAX_SZ_DEPTH = 32;

/**
 * Thrown when an sz object/array nests deeper than {@link MAX_SZ_DEPTH}. A typed
 * error so callers can distinguish a hostile-input limit from a real bug, and so
 * the build pipeline's per-file fallback can swallow it without a stack overflow.
 * A csszyx error with the code `sz-object-depth`.
 */
export class SzDepthError extends CsszyxError {
    /**
     * @param depth - the depth limit that was exceeded (for the message).
     */
    constructor(depth: number = MAX_SZ_DEPTH) {
        const args = { form: 'value', maxDepth: depth } as const;
        super({
            code: 'sz-object-depth',
            args,
            message:
                process.env.NODE_ENV !== 'production'
                    ? szRender({ diagnostic: SZ_OBJECT_DEPTH, args })
                    : `[csszyx] sz-object-depth: ${JSON.stringify(args)} https://csszyx.com/e/sz-object-depth`,
        });
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
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function isForbiddenSzKey(key: string): boolean {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
