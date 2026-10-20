/**
 * How `szv()` and its precompiled pick read a selection value, shared so the
 * two report one value the same way.
 */

import { SZV_UNKNOWN_VARIANT, SZV_UNKNOWN_VARIANT_VALUE } from '@csszyx/compiler/report';

import { devWarn } from './dev-warn.js';

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

/**
 * Say, in development, that a selection names a dimension the factory does
 * not declare, or a value its dimension does not define. `szv()` and its
 * precompiled pick both report through here, so the two print one line.
 *
 * @param key - The selected dimension.
 * @param value - The value selected for it.
 * @param dimensions - The factory's dimensions, each a table of its values.
 */
export function warnSelectionValue(
    key: string,
    value: unknown,
    dimensions: Readonly<Record<string, unknown>> | undefined,
): void {
    if (process.env.NODE_ENV !== 'production') {
        if (dimensions === undefined || !(key in dimensions)) {
            devWarn({ diagnostic: SZV_UNKNOWN_VARIANT, args: { key } });
            return;
        }
        if (value === null || value === undefined) return;
        // A dimension that is no table was reported when the config was read;
        // it defines no value.
        const values = dimensions[key];
        const table = typeof values === 'object' && values !== null ? values : {};
        const valueKey = selectionValueKey(value);
        if (valueKey === null || !(valueKey in table)) {
            devWarn({
                diagnostic: SZV_UNKNOWN_VARIANT_VALUE,
                args: {
                    key,
                    value: valueKey ?? describeValue(value),
                    allowed: Object.keys(table),
                },
            });
        }
    }
}
