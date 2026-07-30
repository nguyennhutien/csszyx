/**
 * Back-compat className helpers for the main `@csszyx/runtime` entry.
 *
 * The implementations live in `core.ts`, which resolves sz OBJECTS through the
 * lowering slot instead of a static compiler import. These wrappers restore
 * the historical contract of this entry — `szr({ p: 4 })` works standalone,
 * no plugin, no extra import — by registering the lowerer on first call. The
 * static `lowerSz` reference below is what makes that guarantee hold, and it
 * is also the price: importing an object-capable helper from THIS entry ships
 * the compiler transform, exactly as it always has.
 *
 * Files processed by the bundler plugin get the slim path instead: helpers
 * from `@csszyx/runtime/core` plus an injected
 * `import '@csszyx/runtime/lowering'` only where an object can actually flow.
 *
 * The registration is deliberately lazy (first call), not module-level: this
 * file is inlined into the flat barrel bundle, and a top-level impure call
 * here would be retained for every barrel consumer — welding the compiler
 * onto `szv`/`szcn`/`szDecode` imports that never touch it.
 *
 * @module @csszyx/runtime/concatenate
 */

import { _sz as coreSz, _szMerge as coreSzMerge, type SzInput } from './core.js';
import { lowerSz } from './lowering.js';
import { getSzLowering, setSzLowering } from './lowering-slot.js';

export type { SzInput } from './core.js';
export { _sz2, _sz3 } from './core.js';

/**
 * Install the lowerer unless one is already registered.
 *
 * One null check on the hot path; the JIT inlines it. Never overwrites an
 * existing registration (it would be the same function anyway).
 */
function ensureLowering(): void {
    if (getSzLowering() === null) {
        setSzLowering(lowerSz);
    }
}

/**
 * Zero-overhead className passthrough/concatenation helper.
 *
 * When the compiler pre-transforms sz objects to strings at build time,
 * this function simply passes through the string (zero overhead).
 * For runtime usage, it can also concatenate multiple class strings
 * or transform SzObjects on-the-fly.
 *
 * @param {...SzInput[]} classes - Class names or SzObjects to concatenate
 * @returns {string} Combined className string
 *
 * @example
 * ```typescript
 * // Passthrough (from compiler) - zero overhead
 * _sz('p-4 bg-red-500')
 * // Returns: "p-4 bg-red-500"
 *
 * // With conditionals
 * _sz('base', isActive && 'active', error && 'error')
 * // Returns: "base active" (if isActive is true, error is false)
 *
 * // With SzObject (runtime transform)
 * _sz({ p: 4, bg: 'red-500' })
 * // Returns: "p-4 bg-red-500"
 * ```
 */
export function _sz(...classes: SzInput[]): string {
    ensureLowering();
    return coreSz(...classes);
}

/**
 * Resolve sz object(s) and/or class strings into a single className string,
 * mangle-aware. This is the PUBLIC, hand-written name for the otherwise
 * compiler-injected `_sz` helper (the `_` prefix marks compiler-generated code
 * you should not hand-author; `szr` is the one you call by hand).
 *
 * Reach for `szr` when you build a className from `szv` factory output or sz
 * objects — e.g. a split/layered design system that declares variants in a
 * module and resolves them at the leaf:
 *
 * ```ts
 * import { szr, szv } from '@csszyx/runtime';
 * const cardSz = szv({ variants: { pad: { lg: { p: 8 } } } });
 * const cls = szr(cardSz({ pad: 'lg' }), isWide && stackSz({ gap: 'xl' }));
 * ```
 *
 * Falsy inputs are skipped (clsx-style). `szr` CONCATENATES (keeps every class);
 * to combine with last-wins OVERRIDE on a same-utility conflict, use `szcn`.
 * `szr` accepts sz OBJECTS; `szcn` accepts className STRINGS.
 *
 * @param classes - sz objects, class strings, or falsy values (skipped).
 * @returns The resolved className string (mangled in a production build).
 */
export const szr: (...classes: SzInput[]) => string = _sz;

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
 * // Returns: "p-2 m-4"
 * ```
 */
export function _szMerge(...classes: SzInput[]): string {
    ensureLowering();
    return coreSzMerge(...classes);
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
 * _szPart({ p: 4 })           // "p-4"      (compiled)
 * _szPart(undefined)          // ""
 * ```
 */
export function _szPart(value: unknown): string {
    return typeof value === 'string' ? value : _szMerge(value as SzInput);
}
