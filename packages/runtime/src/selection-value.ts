/**
 * How `szv()` and its precompiled pick read a selection value, shared so the
 * two report one value the same way.
 */

/**
 * Convert a primitive selection to the string key used by variant tables.
 * Objects and functions are invalid selections and deliberately remain unstringified.
 *
 * @param value - Candidate selection value.
 * @returns Variant-table key, or null for a structurally invalid selection.
 */
export function selectionValueKey(value: unknown): string | null {
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint' ||
        typeof value === 'symbol'
    ) {
        return String(value);
    }
    return null;
}

/**
 * Describe a value a dev warning rejects.
 *
 * @param value - The rejected value.
 * @returns `null`, `an array`, or its `typeof`.
 */
export function describeValue(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    return typeof value;
}
