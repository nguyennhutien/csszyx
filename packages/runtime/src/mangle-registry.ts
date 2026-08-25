/**
 * The runtime mangle registry — where runtime helpers read the production
 * class map from.
 *
 * A production build with `production.mangle` rewrites every csszyx-owned
 * class to a short token, in the CSS and in the compiled JS. Classes resolved
 * AT RUNTIME (`szr`, `szv`, `szcn`, `dynamic()`) must be rewritten too, or
 * they reach the DOM under names no CSS rule matches. The bundler plugin
 * generates a module that calls {@link installMangleRuntime} with the final
 * map; `lowerSz` and the `szcn` merge read it back through
 * {@link getMangleRegistry}.
 *
 * This used to travel through `window.__csszyx`, a debug object an inline
 * `<script>` in the built HTML installed. That welded correctness to an
 * executable inline script — refused by a strict Content-Security-Policy
 * (field-reported) — and to a debug surface. The registry is installed from
 * inside the bundle and exposes that global only when the build asks for it.
 *
 * Same constraints as `lowering-slot.ts`, for the same reasons: no
 * dependencies, no module-level side effects (this is inlined into every
 * entry bundle), and a `globalThis` mirror so the ESM and CJS copies of this
 * package — separate module instances in one process — read one registry.
 *
 * @module @csszyx/runtime/mangle-registry
 */

/** Emitted name(s) for one original CSS custom property. */
export type MangleVarValue = string | string[];

/** What the bundled registration module hands over. */
export interface MangleRegistryInput {
    /** Original class name → mangled token. The only runtime correctness input. */
    mangleMap: Readonly<Record<string, string>>;
    /** Original CSS custom property → emitted name(s). Diagnostics only. */
    varMangleMap?: Readonly<Record<string, MangleVarValue>>;
    /** Checksum of the census; identifies the build the map belongs to. */
    checksum?: string;
    /** Prefix that marks a global custom-property alias. */
    globalVarAliasPrefix?: string;
    /** Also assign the registry to `window.__csszyx`. Off unless configured. */
    exposeDebugGlobal?: boolean;
}

/**
 * The installed registry. Its shape is the historical `window.__csszyx`
 * object, so exposing it for debugging is one assignment, not a second
 * implementation.
 */
export interface MangleRegistry {
    /** Original class name → mangled token. */
    mangleMap: Readonly<Record<string, string>>;
    /** Original CSS custom property → emitted name(s). */
    varMangleMap: Readonly<Record<string, MangleVarValue>>;
    /** Checksum of the census this registry was built from. */
    checksum: string;
    /** Mangled token → original class name. */
    decode(token: string): string | undefined;
    /** Original class name → mangled token. */
    encode(className: string): string | undefined;
    /** Emitted custom-property name → original name(s). */
    decodeVar(name: string): string[];
    /** Original custom-property name → emitted name(s). */
    encodeVar(name: string): MangleVarValue | undefined;
    /** Global alias → original custom-property name. */
    decodeGlobalVar(alias: string): string | undefined;
    /** Every class on an element, decoded where the map knows it. */
    decodeAll(element: Element): string[];
}

/** globalThis carrier for the cross-instance mirror. */
interface MangleRegistryGlobals {
    __csszyx_mangle_registry?: MangleRegistry;
}

/** The installed registry, or null while nothing registered one. */
let current: MangleRegistry | null = null;

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * Own-property lookup: a plain-object map inherits `Object.prototype`, so a
 * hostile or unlucky token (`constructor`, `hasOwnProperty`) would otherwise
 * resolve to a function up the chain.
 *
 * @param map - A plain-object map.
 * @param key - The key to read.
 * @returns The own value, or undefined.
 */
function own<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
    return hasOwn.call(map, key) ? map[key] : undefined;
}

/**
 * Build a registry from the installer inputs.
 *
 * @param input - The bundled map data.
 * @returns A fresh registry.
 */
function createRegistry(input: MangleRegistryInput): MangleRegistry {
    const mangleMap = input.mangleMap;
    const varMangleMap = input.varMangleMap ?? {};
    const prefix = input.globalVarAliasPrefix;
    const reverse: Record<string, string> = Object.create(null);
    for (const key in mangleMap) {
        if (hasOwn.call(mangleMap, key)) reverse[mangleMap[key]] = key;
    }
    const reverseVar: Record<string, string[]> = Object.create(null);
    for (const key in varMangleMap) {
        if (!hasOwn.call(varMangleMap, key)) continue;
        const value = varMangleMap[key];
        for (const emitted of Array.isArray(value) ? value : [value]) {
            const originals = reverseVar[emitted] ?? [];
            originals.push(key);
            reverseVar[emitted] = originals;
        }
    }
    return {
        mangleMap,
        varMangleMap,
        checksum: input.checksum ?? '',
        decode: token => reverse[token],
        encode: className => own(mangleMap, className),
        decodeVar: name => reverseVar[name] ?? [],
        encodeVar: name => own(varMangleMap, name),
        // No prefix means no global aliases were planned for this build.
        decodeGlobalVar: alias =>
            prefix !== undefined && alias.startsWith(prefix) ? reverseVar[alias]?.[0] : undefined,
        decodeAll: element =>
            (element.className || '')
                .split(' ')
                .filter(Boolean)
                .map(token => reverse[token] ?? token),
    };
}

/**
 * Install the runtime mangle map.
 *
 * Idempotent per build: a second install with the same checksum keeps the
 * first registry (two importers of the generated module, two package
 * instances). A different checksum is a different build's map and replaces
 * it. `exposeDebugGlobal` applies either way, so a later opt-in still gets
 * the global.
 *
 * @param input - The bundled map data.
 * @returns The registry now in effect.
 */
export function installMangleRuntime(input: MangleRegistryInput): MangleRegistry {
    const existing = getMangleRegistry();
    const registry =
        existing !== null && existing.checksum === (input.checksum ?? '')
            ? existing
            : createRegistry(input);
    if (registry !== existing) {
        current = registry;
        (globalThis as typeof globalThis & MangleRegistryGlobals).__csszyx_mangle_registry =
            registry;
    }
    if (input.exposeDebugGlobal === true && typeof window !== 'undefined') {
        (window as Window & { __csszyx?: MangleRegistry }).__csszyx = registry;
    }
    return registry;
}

/**
 * The installed registry, or null when no build registered a map.
 *
 * The module-local slot is primary so two package VERSIONS in one app keep
 * their own registries; the global catches the same-version ESM/CJS split.
 *
 * @returns The registry or null.
 */
export function getMangleRegistry(): MangleRegistry | null {
    if (current !== null) {
        return current;
    }
    return (
        (globalThis as typeof globalThis & MangleRegistryGlobals).__csszyx_mangle_registry ?? null
    );
}

/**
 * Forget the installed registry (test isolation).
 */
export function clearMangleRegistry(): void {
    current = null;
    delete (globalThis as typeof globalThis & MangleRegistryGlobals).__csszyx_mangle_registry;
}
