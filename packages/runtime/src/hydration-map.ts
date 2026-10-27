/**
 * The map the hydration checksum is computed over.
 *
 * The build hashes it, the census carries it, and the runtime rebuilds it from
 * the bundled registry when a page ships no census; all three must produce the
 * same keys, so the shape lives here once and the build imports it.
 *
 * @module hydration-map
 */

import type { MangleVarValue } from './mangle-registry.js';

/**
 * The map payload the hydration checksum covers.
 *
 * Class-only builds return the class map unchanged. Builds with variable
 * mangling prefix both namespaces, so a class name and a custom property name
 * cannot collide inside the checksum input.
 *
 * @param classMap - Original class name → mangled token.
 * @param varMap - Original custom property → emitted name(s).
 * @returns The payload the checksum is computed over.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function createHydrationMangleMap(
    classMap: Readonly<Record<string, string>>,
    varMap: Readonly<Record<string, MangleVarValue>> = {},
): Record<string, string> {
    if (Object.keys(varMap).length === 0) {
        return classMap as Record<string, string>;
    }
    const payload: Record<string, string> = {};
    for (const [key, value] of Object.entries(classMap)) {
        payload[`class:${key}`] = value;
    }
    for (const [key, value] of Object.entries(varMap)) {
        if (Array.isArray(value)) {
            for (const mangled of value) {
                payload[`var:${key}:${mangled}`] = mangled;
            }
        } else {
            payload[`var:${key}`] = value;
        }
    }
    return payload;
}
