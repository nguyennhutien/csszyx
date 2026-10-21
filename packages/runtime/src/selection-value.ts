/**
 * How `szv()` and its precompiled pick read a selection value, shared so the
 * two report one value the same way.
 */

import {
    SZV_UNKNOWN_VARIANT,
    SZV_UNKNOWN_VARIANT_VALUE,
    type SzReportOptions,
} from '@csszyx/compiler/report';

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

/** The `szv-unknown-variant` args. */
type UnknownVariantArgs = NonNullable<(typeof SZV_UNKNOWN_VARIANT)['argsType']>;
/** The `szv-unknown-variant-value` args. */
type UnknownValueArgs = NonNullable<(typeof SZV_UNKNOWN_VARIANT_VALUE)['argsType']>;

/**
 * What is wrong with one selected value, as the report that says so: a
 * dimension the factory does not declare, or a value its dimension does not
 * define. Reports nothing itself, so the two callers below each hold the one
 * `NODE_ENV` check around their `devWarn` and a production bundle drops this
 * with the templates it names.
 *
 * @param key - The selected dimension.
 * @param value - The value selected for it.
 * @param dimensions - The factory's dimensions, each a table of its values.
 * @returns The report to print, or undefined when the selection is fine.
 */
function selectionValueReport(
    key: string,
    value: unknown,
    dimensions: Readonly<Record<string, unknown>> | undefined,
): SzReportOptions<UnknownVariantArgs> | SzReportOptions<UnknownValueArgs> | undefined {
    if (dimensions === undefined || !(key in dimensions)) {
        return { diagnostic: SZV_UNKNOWN_VARIANT, args: { key } };
    }
    if (value === null || value === undefined) return undefined;
    // A dimension that is no table was reported when the config was read;
    // it defines no value.
    const values = dimensions[key];
    const table = typeof values === 'object' && values !== null ? values : {};
    const valueKey = selectionValueKey(value);
    if (valueKey !== null && valueKey in table) return undefined;
    const allowed = Object.keys(table);
    const shown = valueKey ?? describeValue(value);
    return {
        diagnostic: SZV_UNKNOWN_VARIANT_VALUE,
        // A dimension that defines no value has none to list.
        args:
            allowed.length > 0
                ? { form: 'listed', key, value: shown, allowed }
                : { form: 'none', key, value: shown },
    };
}

/**
 * Say, in development, that a selection names a dimension the factory does
 * not declare, or a value its dimension does not define. `szv()` and its
 * precompiled pick both report through here, so the two print one line.
 *
 * @param selection - The caller's requested variant values.
 * @param dimensions - The factory's dimensions, each a table of its values.
 */
export function warnSelection(
    selection: Readonly<Record<string, unknown>> | null | undefined,
    dimensions: Readonly<Record<string, unknown>> | undefined,
): void {
    // The check sits before the loop, so a production render pays one call
    // and never walks the selection.
    if (process.env.NODE_ENV !== 'production' && selection) {
        for (const key of Object.keys(selection)) {
            const report = selectionValueReport(key, selection[key], dimensions);
            if (report) devWarn(report);
        }
    }
}

/**
 * {@link warnSelection} for the one dimension a single-dimension pick selects.
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
        const report = selectionValueReport(key, value, dimensions);
        if (report) devWarn(report);
    }
}
