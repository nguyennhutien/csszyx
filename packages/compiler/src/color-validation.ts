/**
 * The one colour-string rule the lowering applies: slash opacity in a string.
 *
 * `transform-core.ts` applies it; the engine mirrors it in
 * `is_dropped_slash_opacity`. Nothing here judges whether a colour class is
 * served; the project's Tailwind does, at build (ADR 0022).
 */

import { PROPERTY_CATEGORY_MAP, PropertyCategory } from './property-types.js';
import { SLASH_OPACITY_STRING, szReport } from './report.js';
import { szWarningsQuiet } from './sz-dev-warnings.js';

/**
 * Whether a colour key drops this string for its slash opacity.
 *
 * A colour key takes its opacity in the object form (`{ color, op }`), so
 * `bg: 'red-500/50'` emits nothing and is reported as `slash-opacity-string`.
 * That is a rule about csszyx's own input, not a verdict on a class: every
 * other string is written as the engine writes it, and whether the project's
 * Tailwind serves it is the build's verdict (ADR 0022). Mirrors
 * `is_dropped_slash_opacity` in the engine: a bare fraction (`1/2`) is a
 * sizing value, a numeric ratio (`4/2.5`) or a function value
 * (`calc(100/5)`) is an arbitrary value, and only a slash after a digit, the
 * shade, is opacity.
 *
 * @param key - The sz key.
 * @param value - The value, without a trailing `!`.
 * @returns True when the lowering emits nothing for it.
 * @example isDroppedSlashOpacity('bg', 'blue-500/20') → true; ('bg', 'white/50') → false
 */
export function isDroppedSlashOpacity(key: string, value: string): boolean {
    const slash = value.indexOf('/');
    return (
        PROPERTY_CATEGORY_MAP[key] === PropertyCategory.COLOR &&
        slash > 0 &&
        /\d/.test(value[slash - 1]) &&
        !value.includes('(') &&
        !/^-?\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(value)
    );
}

/** Slash-opacity values already warned about, so a re-render cannot spam. */
const warnedStringColorOpacity = new Set<string>();

/**
 * Forget which slash-opacity values were warned about, for a test that needs
 * the warning again.
 */
export function __resetStringColorOpacityWarnings(): void {
    warnedStringColorOpacity.clear();
}

/**
 * Warn that slash opacity in a string needs the color-object form instead
 * (`slash-opacity-string`).
 *
 * Nothing is emitted for the value, so this is missing output (ADR 0011): it
 * prints in every mode and in the browser, once per value, and only
 * `CSSZYX_QUIET_SZ_WARNINGS` mutes it.
 *
 * @param key - Color property key.
 * @param color - Rejected color value, including the slash, without `!`.
 * @param location - `file:line` of the sz object, when known.
 */
export function warnStringColorOpacity(key: string, color: string, location?: string): void {
    const token = `${key}:${color}`;
    if (szWarningsQuiet() || warnedStringColorOpacity.has(token)) return;
    warnedStringColorOpacity.add(token);
    const slash = color.indexOf('/');
    const args = { key, color: color.slice(0, slash), opacity: color.slice(slash + 1) };
    if (process.env.NODE_ENV !== 'production') {
        szReport({ diagnostic: SLASH_OPACITY_STRING, args, at: location });
    } else {
        console.warn(
            `[csszyx] slash-opacity-string: ${JSON.stringify(args)} https://csszyx.com/e/slash-opacity-string`,
        );
    }
}
