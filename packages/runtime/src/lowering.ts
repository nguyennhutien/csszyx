/**
 * The object-lowering implementation: compiler transform + mangle awareness.
 *
 * This is the one module whose inclusion means "the compiler ships to the
 * browser". Everything here is reached only through {@link registerSzLowering}
 * or a static reference from the back-compat `@csszyx/runtime` entry — the
 * `/core` helpers never import it, so a bundle where no object can flow at
 * runtime contains none of this.
 *
 * No module-level side effects: registration is a named call so that inlining
 * this file into the barrel bundle cannot defeat tree shaking. The
 * side-effecting registration entry lives in `lowering-register.ts`
 * (published as `@csszyx/runtime/lowering`).
 *
 * @module @csszyx/runtime/lowering
 */

import { transform as rawTransform, type SzObject } from '@csszyx/compiler/browser';

import { setSzLowering } from './lowering-slot.js';

/** A frozen map of original class names to their mangled SSR equivalents. */
type RuntimeMangleMap = Readonly<Record<string, string>>;

/** Global slots that may expose the SSR/runtime mangle map. */
interface CsszyxMangleGlobals {
    __csszyx_ssr_mangle_map?: RuntimeMangleMap;
    __csszyx?: {
        mangleMap?: RuntimeMangleMap;
    };
}

/**
 * Lower one sz object to a className, applying runtime class-name mangling
 * when a mangle map is present on the global (SSR) or window object.
 *
 * @param szProp - The sz object to transform into a className.
 * @returns The className, mangled when a map is active.
 */
export function lowerSz(szProp: object): string {
    // `szProp` is typed `object` (not `SzObject`) so the public `SzInput` can stay
    // broad enough to accept a precise `SzProps`/`SzPropValue` forwarded from the
    // JSX boundary — a named type with specific keys is assignable to `object` but
    // not to `SzObject`'s `{ [k]: SzValue }` index signature. The runtime lowers
    // recognized keys and ignores the rest, so the cast is sound.
    const className = rawTransform(szProp as SzObject).className;
    if (!className) {
        return className;
    }

    const globals = globalThis as typeof globalThis & CsszyxMangleGlobals;
    const ssrMangleMap = globals.__csszyx_ssr_mangle_map || globals.__csszyx?.mangleMap;
    const browserMangleMap =
        typeof window !== 'undefined'
            ? (window as Window & CsszyxMangleGlobals).__csszyx?.mangleMap
            : undefined;
    const activeMangleMap = ssrMangleMap || browserMangleMap;

    if (activeMangleMap) {
        return className
            .split(/\s+/)
            .filter(Boolean)
            .map((c: string) => activeMangleMap[c] || c)
            .join(' ');
    }
    return className;
}

/**
 * Register {@link lowerSz} into the lowering slot.
 *
 * Idempotent — repeat registration installs the same function.
 */
export function registerSzLowering(): void {
    setSzLowering(lowerSz);
}
