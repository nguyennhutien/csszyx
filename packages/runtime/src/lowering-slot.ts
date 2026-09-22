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

/**
 * Lowers sz input to its className string (mangle-aware).
 *
 * An ARRAY is a run of adjacent objects from one composition site; the
 * lowerer deep-merges them before transforming, so a later element holding
 * only part of a fused value overrides that part instead of lowering alone.
 */
export type SzLowering = (szProp: object | readonly object[]) => string;

/** The registered lowerer, or null while no object-capable module is loaded. */
let current: SzLowering | null = null;

/** globalThis carrier for the cross-instance fallback slot. */
interface SzLoweringGlobals {
    __csszyx_lowering?: SzLowering;
    __csszyx_class_prefix?: string;
    __csszyx_class_prefix_registration?: { readonly value: string | null };
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

/** The Tailwind prefix object lowering writes before every class, or null. */
let currentClassPrefix: string | null = null;
let currentClassPrefixRegistration: { readonly value: string | null } | undefined;

/** Apply a normalized Tailwind prefix to local and global runtime state.
 *
 * @param prefix - The configured prefix, or null when no prefix is configured.
 */
function applySzClassPrefix(prefix: string | null): void {
    currentClassPrefix = prefix === '' ? null : prefix;
    const globals = globalThis as typeof globalThis & SzLoweringGlobals;
    if (currentClassPrefix === null) {
        delete globals.__csszyx_class_prefix;
    } else {
        globals.__csszyx_class_prefix = currentClassPrefix;
    }
}

/**
 * Register the Tailwind prefix the project's stylesheet sets.
 *
 * The build inserts this call beside the runtime import of every module that
 * lowers an sz object in the browser, because only the build could read the
 * stylesheet. Mirrored onto `globalThis` for the same reason the lowerer is:
 * a bundle holding two copies of this package has two module states, and the
 * copy that registered is not always the copy that lowers.
 *
 * @param prefix - The prefix, such as `tw` for `prefix(tw)`; null or empty for none.
 */
export function setSzClassPrefix(prefix: string | null): void {
    const globals = globalThis as typeof globalThis & SzLoweringGlobals;
    currentClassPrefixRegistration = undefined;
    delete globals.__csszyx_class_prefix_registration;
    applySzClassPrefix(prefix);
}

/**
 * Register the one prefix shared by modules executing in this JavaScript realm.
 *
 * Compiler-injected calls use this stricter entrypoint. Silently replacing an
 * earlier value would make runtime objects emit classes belonging to another
 * independently built application. A disagreement therefore fails before any
 * styling can be corrupted. {@link setSzClassPrefix} remains the explicit
 * reset API for tests and controlled host integrations.
 *
 * Each call performs `O(1)` time and space work regardless of project size.
 * The adversarial transition is a second runtime copy registering a different
 * prefixed or unprefixed value through the shared global slot; that transition
 * throws before either the local or global active prefix is changed. Vite,
 * Rollup, webpack, Next Turbopack, and Jest all receive the call through their
 * shared runtime-import injection path.
 *
 * @param prefix - The build's prefix, or null when its stylesheet has none.
 * @throws When another module in the realm registered a different value.
 * @internal Called by generated code, not written by hand. The three
 * engines share these names as an ABI: a changed shape makes classes
 * vanish where a build and a runtime differ in version, so a new shape
 * gets a new name.
 */
export function registerSzClassPrefix(prefix: string | null): void {
    const value = prefix === '' ? null : prefix;
    const globals = globalThis as typeof globalThis & SzLoweringGlobals;
    const registered = currentClassPrefixRegistration ?? globals.__csszyx_class_prefix_registration;
    if (registered !== undefined && registered.value !== value) {
        const describe = (candidate: string | null): string =>
            candidate === null ? 'no prefix' : `prefix(${candidate})`;
        throw new Error(
            `[csszyx] two builds sharing one JavaScript runtime registered different Tailwind prefixes: ${describe(registered.value)} and ${describe(value)}. ` +
                'Keep independently configured applications on separate @csszyx/runtime instances or align their Tailwind prefix.',
        );
    }
    const registration = registered ?? { value };
    currentClassPrefixRegistration = registration;
    globals.__csszyx_class_prefix_registration = registration;
    applySzClassPrefix(value);
}

/**
 * The Tailwind prefix object lowering writes, from this copy or another.
 *
 * @returns The registered prefix, or null when none is.
 */
export function getSzClassPrefix(): string | null {
    if (currentClassPrefix !== null) {
        return currentClassPrefix;
    }
    const globals = globalThis as typeof globalThis & SzLoweringGlobals;
    return globals.__csszyx_class_prefix ?? null;
}
