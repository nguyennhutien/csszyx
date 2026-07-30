/**
 * Merge-family string helpers, published as `@csszyx/runtime/merge`.
 *
 * `_szMerge`/`_szPart` need the group-merge machinery (`_szcn` and its
 * box-role tables, ~4.5 KB gz) that the concat family in `/core` does not —
 * keeping them here lets an szr-only bundle stay a few hundred bytes while a
 * file whose array parts are provably strings imports THIS entry and still
 * ships no compiler. Object support arrives exactly as it does for `/core`:
 * the lowering slot, loud error without it.
 *
 * @module @csszyx/runtime/merge
 */

import { _sz, type SzInput } from './core.js';
import { _szcn } from './merge-classes.js';

export type { SzInput } from './core.js';
export { _szcn } from './merge-classes.js';

/**
 * Merges className strings with mangle-aware, utility-group last-wins semantics.
 *
 * Useful when combining multiple className sources that may overlap.
 *
 * @param {...SzInput[]} classes - Class names or SzObjects to merge
 * @returns {string} Merged className string with later utility conflicts winning
 *
 * @example
 * ```typescript
 * _szMerge('gap-2 p-4', 'gap-8')
 * // Returns: "p-4 gap-8"
 *
 * _szMerge({ p: 4 }, { p: 2, m: 4 })
 * // Returns: "p-2 m-4" (needs the lowering module for objects)
 * ```
 */
export function _szMerge(...classes: SzInput[]): string {
    return _szcn(_sz(...classes));
}

/**
 * Normalizes one dynamic element of a compiled sz array into a class string
 * for `szcn`.
 *
 * The build rewrites `sz={[...]}` arrays with runtime elements into
 * `szcn(..., _szPart(<expr>), ...)`: the compiler cannot know whether the
 * expression yields a class string (a forwarded `szsc` slot), an sz object,
 * or a falsy guard — this helper resolves whichever arrives so `szcn` only
 * ever group-merges strings. Strings pass through untouched; everything else
 * (sz objects, nested arrays, falsy) goes through `_szMerge`'s existing
 * compile-and-join.
 *
 * @param {unknown} value - One runtime array element.
 * @returns {string} The element as a class string (`''` for falsy).
 *
 * @example
 * ```typescript
 * _szPart('text-lg')          // "text-lg"  (string passthrough)
 * _szPart({ p: 4 })           // "p-4"      (compiled; needs lowering)
 * _szPart(undefined)          // ""
 * ```
 */
export function _szPart(value: unknown): string {
    return typeof value === 'string' ? value : _szMerge(value as SzInput);
}
