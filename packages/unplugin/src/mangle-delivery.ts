/**
 * Whether a build has a runtime mangle map worth registering.
 *
 * Three lanes decide independently where the map goes — the Vite HTML entry,
 * the per-consumer import injection, and webpack's generated file — and a
 * consumer with mangling OFF still received an executable inline installer
 * carrying an empty map, which a `script-src 'self'` policy refused
 * (field-reported). One predicate, called by every lane, is what keeps a
 * fourth lane from reintroducing that.
 *
 * @module mangle-delivery
 */

/**
 * Whether runtime helpers need the map registered for this build.
 *
 * The CLASS map is the only correctness input: `lowerSz` and `szcn` read it,
 * nothing at runtime reads the variable map (it feeds the inert census, the
 * checksum and the debug helpers). So an enabled build with an empty class
 * map has nothing for runtime helpers to consume, and registering it is pure
 * cost.
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

/**
 * The once-per-build notice for a config that still sets the removed
 * `production.mangleMapDelivery` option.
 *
 * An unread option is silent, so an author who set `'html'` to get the inline
 * installer would otherwise never learn that the installer is gone — and one
 * who set `'bundle'` for CSP would not learn that they can drop the line.
 *
 * @returns The warning text.
 */
export function removedMangleMapDeliveryMessage(): string {
    return (
        '[csszyx] production.mangleMapDelivery has been removed and is ignored. The runtime ' +
        'mangle map is always registered from inside the JS bundle now, on every lane, so the ' +
        "built HTML never carries an executable inline <script> and a strict script-src 'self' " +
        'policy needs no exception. Delete the option. (`window.__csszyx` is now opt-in through ' +
        '`production.mangleDebugGlobal`.)'
    );
}
