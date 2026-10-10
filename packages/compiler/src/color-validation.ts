/**
 * The one colour-string rule the lowering applies: slash opacity in a string.
 *
 * Used by both the TypeScript compiler (transform-core.ts) and the
 * WASM pre-validator (compiler.ts) to guarantee identical behavior
 * across all transformation code paths. Nothing here judges whether a colour
 * class is served; the project's Tailwind does, at build (ADR 0022).
 */

import { PROPERTY_CATEGORY_MAP, PropertyCategory } from './property-types.js';
import { szWarningsQuiet } from './sz-dev-warnings.js';
import { isForbiddenSzKey, MAX_SZ_DEPTH, SzDepthError } from './sz-limits.js';

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

/**
 * Walks an sz object and strips the slash-opacity colour strings the
 * lowering drops, warning once for each (see {@link warnStringColorOpacity}).
 *
 * Returns a new object safe to pass to transform_sz (WASM path), which
 * cannot print the warning itself.
 *
 * @param sz - The sz prop object to sanitize.
 * @param _depth - The current recursion depth (for depth bounding).
 * @returns A new object with those strings removed.
 */
export function stripInvalidColorStrings(
    sz: Record<string, unknown>,
    _depth = 0,
): Record<string, unknown> {
    if (_depth >= MAX_SZ_DEPTH) {
        throw new SzDepthError();
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sz)) {
        const sanitized = sanitizeColorEntry(key, value, _depth);
        if (sanitized.keep) result[key] = sanitized.value;
    }
    return result;
}

/**
 * Sanitize one key/value pair while preserving recursive variants.
 * @param key - Sz property or variant key.
 * @param value - Candidate value.
 * @param depth - Current recursion depth.
 * @returns Sanitized value and whether to retain it.
 */
function sanitizeColorEntry(
    key: string,
    value: unknown,
    depth: number,
): { keep: boolean; value: unknown } {
    if (isForbiddenSzKey(key)) return { keep: false, value };
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return {
            keep: true,
            value: stripInvalidColorStrings(value as Record<string, unknown>, depth + 1),
        };
    }
    if (typeof value !== 'string') return { keep: true, value };
    const color = value.replace(/!$/, '');
    if (!isDroppedSlashOpacity(key, color)) return { keep: true, value };
    warnStringColorOpacity(key, color);
    return { keep: false, value };
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
 * Warn that slash opacity in a string needs the color-object form instead.
 *
 * Nothing is emitted for the value, so this is missing output (ADR 0011): it
 * prints in every mode and in the browser, once per value, and only
 * `CSSZYX_QUIET_SZ_WARNINGS` mutes it. The engines render the same text with
 * the code `slash-opacity-string`.
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
    const at = location ? ` at ${location}` : '';
    console.warn(
        `[csszyx] "${key}: '${color}'"${at} — string slash opacity is not supported, and ` +
            'nothing is emitted for it. Use object form: ' +
            `{ color: '${color.slice(0, slash)}', op: ${color.slice(slash + 1)} }.`,
    );
}
