/**
 * `suggestSzKey` as it was before the bit-parallel search: every known name
 * against the key through a bounded three-row optimal string alignment table,
 * with no memo. Kept verbatim as the oracle the current search is held to
 * (`sz-key-suggestion-differential.test.ts`); not used by any source.
 */
import {
    BOOLEAN_SHORTHANDS,
    KNOWN_SPECIAL_PROPERTIES,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    SUGGESTION_MAP,
} from '../../src/transform-core.js';

/**
 * The bounded optimal string alignment distance, as it was.
 *
 * @param a - First string.
 * @param b - Second string.
 * @param bound - The largest distance the caller can use.
 * @returns The distance, or `bound + 1` when it is larger.
 */
function editDistance(a: string, b: string, bound: number): number {
    let twoBack: number[] = [];
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= b.length; j += 1) {
            let distance = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                distance = Math.min(distance, twoBack[j - 2] + 1);
            }
            current.push(distance);
        }
        if (Math.min(...current) > bound) return bound + 1;
        twoBack = previous;
        previous = current;
    }
    return previous[b.length];
}

/**
 * The nearest target, as it was.
 *
 * @param key - The name as authored.
 * @param candidates - Known names with their targets.
 * @param maxDistance - The largest distance still worth suggesting.
 * @returns The target, or null.
 */
function nearestName(
    key: string,
    candidates: ReadonlyArray<readonly [string, string]>,
    maxDistance: number,
): string | null {
    const lower = key.toLowerCase();
    let best = Number.POSITIVE_INFINITY;
    const targets = new Set<string>();
    for (const [name, target] of candidates) {
        if (Math.abs(name.length - key.length) > maxDistance) continue;
        const distance = editDistance(lower, name.toLowerCase(), Math.min(best, maxDistance));
        if (distance < best) {
            best = distance;
            targets.clear();
        }
        if (distance === best) targets.add(target);
    }
    if (best > maxDistance || targets.size !== 1) return null;
    const [target] = targets;
    return target;
}

/** Known keys and aliases with the key to suggest, as they were collected. */
export const LEGACY_SZ_KEY_NAMES: ReadonlyArray<readonly [string, string]> = (() => {
    const names = new Map<string, string>();
    for (const key of [
        ...Object.keys(PROPERTY_MAP),
        ...KNOWN_SPECIAL_PROPERTIES,
        ...BOOLEAN_SHORTHANDS,
        ...KNOWN_VARIANTS,
    ]) {
        names.set(key, key);
    }
    for (const [alias, canonical] of Object.entries(SUGGESTION_MAP)) {
        if (/^[a-z][a-z0-9]*$/i.test(canonical)) names.set(alias, canonical);
    }
    return [...names];
})();

/**
 * The suggestion for a key, as it was computed.
 *
 * @param key - The unknown key.
 * @returns The canonical key, or null.
 */
export function legacySuggestSzKey(key: string): string | null {
    const maxDistance = Math.min(key.length >= 12 ? 2 : 1, Math.floor(key.length / 3));
    return nearestName(key, LEGACY_SZ_KEY_NAMES, maxDistance);
}
