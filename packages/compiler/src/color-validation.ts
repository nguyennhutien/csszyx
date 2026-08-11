/**
 * Shared color string validation helpers.
 *
 * Used by both the TypeScript compiler (transform-core.ts) and the
 * WASM pre-validator (compiler.ts) to guarantee identical behavior
 * across all transformation code paths.
 */

import { PROPERTY_CATEGORY_MAP, PropertyCategory } from './property-types.js';
import { szDevWarningsEnabled } from './sz-dev-warnings.js';
import { isForbiddenSzKey, MAX_SZ_DEPTH, SzDepthError } from './sz-limits.js';

export const COLOR_STRING_KEYWORDS: Set<string> = new Set([
    'inherit',
    'current',
    'transparent',
    'black',
    'white',
    'none',
]);

/**
 * Returns true if a string value is a recognized color pattern.
 *
 * Syntactic check only — does not require knowledge of the Tailwind theme.
 * Custom theme colors like brand-500 are accepted (word-number pattern).
 *
 * @param value - The color string to validate.
 * @returns True if the value matches a known color pattern.
 */
export function isValidColorString(value: string): boolean {
    if (COLOR_STRING_KEYWORDS.has(value)) {
        return true;
    }
    if (value.startsWith('--')) {
        return true;
    } // CSS var: --my-color
    if (value.startsWith('#')) {
        return true;
    } // Hex: #ff0000
    if (value.startsWith('[') && value.endsWith(']')) {
        return true;
    } // Pre-bracketed
    // Color functions (auto-bracketed downstream)
    if (/^(rgb|hsl|oklch|color|hwb|lab|lch|oklab)\(/.test(value)) {
        return true;
    }
    // Color scale: blue-500, brand-500, brand-primary-500 — any word-number pattern
    if (/^[a-z][a-z0-9]*(-[a-z0-9]+)*-\d+$/i.test(value)) {
        return true;
    }
    // Tailwind v4 semantic tokens: single-word or hyphenated identifiers without trailing number.
    // Any CSS identifier is a potential semantic token (e.g. 'primary', 'muted-foreground').
    // We accept these rather than falsely rejecting valid theme tokens.
    if (/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/i.test(value)) {
        return true;
    }
    return false;
}

/**
 * Returns true if a color string uses slash opacity notation.
 * Only matches color-scale/number patterns where the character before
 * the slash is a digit (the shade number).
 *
 * @param value - The color string to check.
 * @returns True if the value contains slash opacity (e.g. "blue-500/20").
 * @example "blue-500/20" → true, "blue-500" → false
 */
export function hasSlashOpacity(value: string): boolean {
    const slashIdx = value.indexOf('/');
    if (slashIdx === -1) {
        return false;
    }
    return slashIdx > 0 && /\d$/.test(value.slice(0, slashIdx));
}

/**
 * Walks an sz object and strips invalid/slash-opacity color string values.
 * Emits console.warn for each stripped value.
 *
 * Returns a new object safe to pass to transform_sz (WASM path).
 * Only warns in non-production / server-side environments.
 *
 * @param sz - The sz prop object to sanitize.
 * @param _depth - The current recursion depth (for depth bounding).
 * @returns A new object with invalid color strings removed.
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
    if (typeof value !== 'string' || PROPERTY_CATEGORY_MAP[key] !== PropertyCategory.COLOR) {
        return { keep: true, value };
    }
    const color = value.replace(/!$/, '');
    if (hasSlashOpacity(color)) {
        warnInvalidColor(key, color, true);
        return { keep: false, value };
    }
    if (!isValidColorString(color)) {
        warnInvalidColor(key, color, false);
        return { keep: false, value };
    }
    return { keep: true, value };
}

/**
 * Warn that a color string is not recognized and is therefore dropped.
 *
 * Exported because the same value is rejected on two paths — the TypeScript
 * transform and the WASM pre-validation — and the message must be one text.
 * It was written out twice before, and the copies had already drifted apart in
 * which conditions they printed under.
 *
 * @param key - Color property key.
 * @param color - Rejected color value.
 */
export function warnUnrecognizedColor(key: string, color: string): void {
    if (!szDevWarningsEnabled()) return;
    console.warn(
        `[csszyx] "${key}: '${color}'" is not a recognized color value and will be ignored. ` +
            'Use a Tailwind color ("blue-500"), CSS variable ("--my-color"), ' +
            'hex/rgb/hsl ("#ff0000"), or object form ({ color: "blue-500", op: 50 }).',
    );
}

/**
 * Warn that slash opacity in a string needs the color-object form instead.
 *
 * @param key - Color property key.
 * @param color - Rejected color value, including the slash.
 */
export function warnStringColorOpacity(key: string, color: string): void {
    if (!szDevWarningsEnabled()) return;
    const slash = color.indexOf('/');
    console.warn(
        `[csszyx] "${key}: '${color}'" — string slash opacity is not supported. ` +
            `Use object form: { color: '${color.slice(0, slash)}', op: ${color.slice(slash + 1)} }.`,
    );
}

/**
 * Emit development-only guidance for a rejected color string.
 * @param key - Color property key.
 * @param color - Rejected color value.
 * @param slashOpacity - Whether slash-opacity syntax caused rejection.
 */
function warnInvalidColor(key: string, color: string, slashOpacity: boolean): void {
    if (slashOpacity) {
        warnStringColorOpacity(key, color);
        return;
    }
    warnUnrecognizedColor(key, color);
}
