/**
 * Runtime picker for build-precompiled szv tables.
 *
 * The compiler rewrites `szr(F(selection))` — where `F` is a file-local
 * `szv(<static config>)` factory whose branches share no canonical sz key —
 * into `__szvPick(TABLE, selection)`: every variant leaf is lowered to its
 * class string at build time, and this function only selects and joins. That
 * replaces a full object lowering per render (~3,469 ns measured) with string
 * concatenation (~7 ns), and because the result is a string, the szr import
 * rewrite can then drop the browser transform from the bundle entirely.
 *
 * Behaviour MIRRORS `szv()`'s runtime resolution exactly — the rewrite is only
 * sound if the two paths are indistinguishable:
 * - a `null`/`undefined` selection value falls back to the default rather than
 *   clearing it;
 * - only OWN selection properties count (an inherited property must not
 *   activate a variant);
 * - an unknown value selects nothing (and warns in dev, same message);
 * - lookup keys coerce the way property access always has (`true` → `'true'`).
 *
 * String-only by design: this module must never reference the compiler.
 *
 * @module @csszyx/runtime/szv-pick
 */

import { devWarn } from './dev-warn.js';

/** A build-precompiled szv config: every branch lowered to its class string. */
export interface SzvCompiledTable {
    /** Compiled `base` classes (empty string when the config had none). */
    base: string;
    /** Compiled variant leaves: dimension → value → class string. */
    d: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /** `defaultVariants`, applied when the selection omits a dimension. */
    defaults?: Readonly<Record<string, string>>;
}

/** A runtime variant selection, same shape `szv` factories accept. */
export type SzvPickSelection = Readonly<Record<string, unknown>> | undefined;

/**
 * Select and join the compiled classes for one szv selection.
 *
 * @param table - Build-emitted table for one szv factory.
 * @param selection - Runtime variant selection (optional, like the factory's).
 * @returns The joined className string.
 */
export function __szvPick(table: SzvCompiledTable, selection?: SzvPickSelection): string {
    if (process.env.NODE_ENV !== 'production') {
        warnUnknownPickSelection(table, selection);
    }
    let result = table.base;
    for (const dimension of Object.keys(table.d)) {
        // Own properties only: `Object.keys(selection)` drove the original
        // resolution, so an inherited `selection.pad` never activated a variant.
        const selected =
            selection !== undefined &&
            selection !== null &&
            // biome-ignore lint/suspicious/noPrototypeBuiltins: the auto-fix is Object.hasOwn, which is ES2022 — this package ships to ES2021 browsers.
            Object.prototype.hasOwnProperty.call(selection, dimension)
                ? selection[dimension]
                : undefined;
        // null/undefined falls back to the default — it does not clear it.
        const value =
            selected === null || selected === undefined ? table.defaults?.[dimension] : selected;
        if (value === null || value === undefined) {
            continue;
        }
        // Property access coerces exactly like `variants[dim][value as string]`
        // did; an unknown value reads undefined and selects nothing.
        const classes = table.d[dimension][value as string];
        if (classes) {
            result = result ? `${result} ${classes}` : classes;
        }
    }
    return result;
}

/**
 * Dev-only mirror of `szv()`'s invalid-selection warnings, byte for byte.
 *
 * @param table - Build-emitted table for one szv factory.
 * @param selection - Runtime variant selection.
 */
function warnUnknownPickSelection(table: SzvCompiledTable, selection: SzvPickSelection): void {
    if (!selection) {
        return;
    }
    for (const key of Object.keys(selection)) {
        const value = selection[key];
        if (!(key in table.d)) {
            devWarn(
                `szv()(selection): unknown variant "${key}" — not declared in config.variants.`,
            );
            continue;
        }
        if (value === null || value === undefined) continue;
        const valueKey = pickSelectionValueKey(value);
        if (valueKey === null || !(valueKey in table.d[key])) {
            devWarn(
                `szv()(selection): "${valueKey ?? describePickValue(value)}" is not a value of variant "${key}" — it has no styles.`,
            );
        }
    }
}

/**
 * Convert a primitive selection to the string key used by variant tables.
 *
 * @param value - Candidate selection value.
 * @returns Variant-table key, or null for a structurally invalid selection.
 */
function pickSelectionValueKey(value: unknown): string | null {
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
 * Describe a structurally invalid selection value, mirroring `szv()`.
 *
 * @param value - The rejected value.
 * @returns A short description for the dev warning.
 */
function describePickValue(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    return typeof value;
}
