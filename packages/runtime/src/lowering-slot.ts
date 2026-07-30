/**
 * Registration slot for the object-lowering function.
 *
 * The string helpers (`_sz`, `szr`, `_szMerge`, `_szPart`) accept sz OBJECTS,
 * and lowering an object needs the compiler's browser transform — ~12.6 KB gz,
 * two orders of magnitude more than every string path combined. A static
 * import would weld that cost onto every consumer of those helpers whether or
 * not an object ever flows, which is exactly what field measurement showed:
 * `import { szr }` alone shipped the whole transform.
 *
 * This slot breaks the static reference: helpers look the lowerer up at call
 * time, and whoever needs object support registers it — the bundler plugin by
 * injecting `import '@csszyx/runtime/lowering'` into files that can pass
 * objects, or the back-compat `@csszyx/runtime` entry eagerly on first use.
 *
 * This module must stay dependency-free and free of module-level side effects:
 * it is inlined into every entry bundle, and a top-level impure statement here
 * would defeat tree shaking for the whole barrel.
 *
 * @module @csszyx/runtime/lowering-slot
 */

/** Lowers one sz object to its className string (mangle-aware). */
export type SzLowering = (szProp: object) => string;

/** The registered lowerer, or null while no object-capable module is loaded. */
let current: SzLowering | null = null;

/** globalThis carrier for the cross-instance fallback slot. */
interface SzLoweringGlobals {
    __csszyx_lowering?: SzLowering;
}

/**
 * Register (or clear, in tests) the object lowerer.
 *
 * Idempotent by construction — every registrant supplies the same compiled
 * transform, so last-write-wins is safe.
 *
 * The lowerer is also mirrored onto `globalThis` (same precedent as the
 * `__csszyx` mangle map): the ESM and CJS builds of this package are separate
 * module instances, so a process that loads both — vitest CJS interop under an
 * ESM test file, a server bundle requiring what the client bundle imports —
 * would otherwise register into one instance while the helpers read the other.
 * The module-local slot stays primary so two different package VERSIONS in one
 * app keep their own registrations; the global only catches the
 * same-version-different-format split.
 *
 * @param lowering - The lowerer, or null to reset (test isolation only).
 */
export function setSzLowering(lowering: SzLowering | null): void {
    current = lowering;
    const globals = globalThis as typeof globalThis & SzLoweringGlobals;
    if (lowering === null) {
        delete globals.__csszyx_lowering;
    } else {
        globals.__csszyx_lowering = lowering;
    }
}

/**
 * The registered lowerer, or null when objects cannot be lowered yet.
 *
 * @returns The active lowerer or null.
 */
export function getSzLowering(): SzLowering | null {
    if (current !== null) {
        return current;
    }
    const globals = globalThis as typeof globalThis & SzLoweringGlobals;
    return globals.__csszyx_lowering ?? null;
}
