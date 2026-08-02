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

import { _sz as coreSz, type SzInput } from './core.js';
import { lowerSz } from './lowering.js';
import { getSzLowering, setSzLowering } from './lowering-slot.js';
import { _szMerge as coreSzMerge } from './merge.js';

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
 * Back-compat `_sz`, with the barrel's lazy lowering registration applied
 * first. Canonical contract, examples, and the compiler-injection note live
 * on {@link coreSz} in `core.ts` — this file only adds `ensureLowering()`.
 *
 * @param classes - Class strings, sz objects, arrays, or falsy values.
 * @returns The resolved className string.
 * @see {@link coreSz} for the full docblock, examples included.
 */
export function _sz(...classes: SzInput[]): string {
    ensureLowering();
    return coreSz(...classes);
}

/**
 * Back-compat `szr` — the public, hand-written name for {@link _sz}. See
 * {@link coreSz} for the full contract (`szr` vs `szcn`, falsy handling).
 */
export const szr: (...classes: SzInput[]) => string = _sz;

/**
 * Back-compat `_szMerge`, with the barrel's lazy lowering registration
 * applied first. Canonical contract and examples live on {@link coreSzMerge}
 * in `merge.ts` — this file only adds `ensureLowering()`.
 *
 * @param classes - Class strings, sz objects, arrays, or falsy values.
 * @returns The merged className string, last utility winning.
 * @see {@link coreSzMerge} for the full docblock, examples included.
 */
export function _szMerge(...classes: SzInput[]): string {
    ensureLowering();
    return coreSzMerge(...classes);
}

/**
 * Back-compat `_szPart`, delegating to this file's lowering-aware `_szMerge`
 * above. Body and contract are identical to `merge.ts`'s `_szPart` by
 * construction — both are `typeof value === 'string' ? value :
 * <local _szMerge>(value)`; only which `_szMerge` they close over differs
 * (this one registers the lowerer first). See `merge.ts` for the full
 * docblock, examples included.
 *
 * @param value - One compiled array element: a class string or an sz object.
 * @returns The element's className contribution.
 */
export function _szPart(value: unknown): string {
    return typeof value === 'string' ? value : _szMerge(value as SzInput);
}
