/**
 * Shared CLI-list parsing for the benchmark harnesses.
 *
 * Every harness that takes a comma-separated mode list rejects an unknown
 * value instead of dropping it. A silently dropped value is how `oxc` rows
 * kept being reported after that lane was removed: the plugin ignored
 * `CSSZYX_PARSER=oxc`, ran its default, and the report compared rust with
 * rust under two labels.
 */

/**
 * Lane names that existed before the TypeScript transform lanes were removed.
 * The engine now ships as one Rust implementation in two artifacts: `rust`
 * (native addon) and `wasm`.
 */
const REMOVED_LANES: ReadonlyMap<string, string> = new Map([
    ['oxc', 'wasm'],
    ['babel', 'wasm'],
]);

/**
 * Split a comma-separated CLI value into trimmed, non-empty items.
 *
 * @param value - raw option value.
 * @returns the items in input order.
 */
export function parseCsv(value: string): string[] {
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

/**
 * Parse a comma-separated option against an allowlist, failing loudly on any
 * value outside it. A removed parser lane gets a hint naming its replacement.
 *
 * @param value - raw option value.
 * @param allowed - accepted values.
 * @param option - option name used in the error message (e.g. `--modes`).
 * @returns the de-duplicated values in input order.
 * @throws {Error} when a value is not allowed or the list is empty.
 */
export function parseAllowlistedCsv<const T extends string>(
    value: string,
    allowed: readonly T[],
    option: string,
): T[] {
    const parsed = parseCsv(value);
    for (const item of parsed) {
        if (allowed.includes(item as T)) continue;
        const replacement = REMOVED_LANES.get(item);
        const hint =
            replacement !== undefined && allowed.includes(replacement as T)
                ? ` The ${item} lane was removed; use "${replacement}" to measure the wasm artifact.`
                : '';
        throw new Error(`Unknown ${option} value "${item}".${hint}`);
    }
    if (parsed.length === 0) throw new Error(`${option} must not be empty.`);
    return [...new Set(parsed)] as T[];
}
