/**
 * Where, and whether, the runtime mangle map is delivered.
 *
 * Three lanes decide this independently today — the HTML transformer, the
 * webpack layout rewrite, and the virtual-module injection — and a consumer
 * with mangling OFF still received an executable inline installer carrying an
 * empty map, which a `script-src 'self'` policy refused (field-reported). One
 * predicate, called by every lane, is what keeps a fourth lane from
 * reintroducing that.
 *
 * @module mangle-delivery
 */

import type { MangleMapDelivery } from '@csszyx/types';

/**
 * Whether a build has a runtime mangle map worth registering.
 *
 * The CLASS map is the only correctness input: `lowerSz` and `szcn` read it,
 * nothing at runtime reads the variable map (it feeds the inert census, the
 * checksum and the debug helpers). So an enabled build with an empty class
 * map has nothing for runtime helpers to consume, and emitting an installer
 * for it is pure cost — executable inline cost, on the HTML lanes.
 *
 * @param manglingEnabled - Whether class mangling is on for this build.
 * @param mangleMap - The class → token map as far as the lane knows it.
 * @returns True when runtime helpers need the map registered.
 */
export function needsRuntimeMangleRegistration(
    manglingEnabled: boolean,
    mangleMap: Readonly<Record<string, string>>,
): boolean {
    if (!manglingEnabled) return false;
    for (const _ in mangleMap) return true;
    return false;
}

/** The delivery channels a configured (or defaulted) mode turns on. */
export interface ResolvedMangleMapDelivery {
    /** The mode in effect. */
    mode: MangleMapDelivery;
    /** Whether the author set the mode, as opposed to receiving the default. */
    explicit: boolean;
    /** Emit the legacy executable inline installer into build-owned HTML. */
    inlineInstaller: boolean;
    /** Register the map from a module inside the JS bundle. */
    bundleModule: boolean;
}

/** Modes that still emit executable inline JavaScript into HTML. */
const LEGACY_MODES: ReadonlySet<MangleMapDelivery> = new Set(['html', 'both']);

/**
 * Resolve `production.mangleMapDelivery` into the channels it enables.
 *
 * Unset means `bundle`: registration from inside the JS bundle is the one
 * delivery that needs no CSP exception, and the HTML-entry module tag makes
 * it reach every consumer the old inline script reached. `html` and `both`
 * remain for one migration window and are reported as legacy so the caller
 * can warn.
 *
 * @param configured - The authored value, if any.
 * @returns The channels in effect.
 * @throws When the value is not one of the three modes — a typo would
 *   otherwise read as a valid mode through negative comparisons, silently, in
 *   the option whose whole point is narrowing.
 */
export function resolveMangleMapDelivery(configured: unknown): ResolvedMangleMapDelivery {
    if (configured === undefined) {
        return { mode: 'bundle', explicit: false, inlineInstaller: false, bundleModule: true };
    }
    if (configured !== 'both' && configured !== 'html' && configured !== 'bundle') {
        throw new Error(
            `[csszyx] production.mangleMapDelivery must be 'both', 'html' or 'bundle'; got ${JSON.stringify(configured)}.`,
        );
    }
    return {
        mode: configured,
        explicit: true,
        inlineInstaller: configured !== 'bundle',
        bundleModule: configured !== 'html',
    };
}

/**
 * Whether a resolved mode is one of the deprecated inline-installer modes.
 *
 * @param delivery - A resolved delivery.
 * @returns True for `html` and `both`.
 */
export function isLegacyMangleMapDelivery(delivery: ResolvedMangleMapDelivery): boolean {
    return LEGACY_MODES.has(delivery.mode);
}

/**
 * The once-per-build warning for an explicit legacy delivery mode.
 *
 * @param mode - The configured legacy mode.
 * @returns The warning text.
 */
export function legacyMangleMapDeliveryMessage(mode: MangleMapDelivery): string {
    return (
        `[csszyx] production.mangleMapDelivery: '${mode}' emits an executable inline ` +
        "<script> into the built HTML, which a strict Content-Security-Policy (script-src 'self') " +
        "refuses. 'bundle' (the default) registers the map from inside the JS bundle instead and " +
        `needs no CSP exception; '${mode}' is deprecated and will be removed in a future major.`
    );
}
