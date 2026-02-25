/**
 * Shared color string validation helpers.
 *
 * Used by both the TypeScript compiler (transform-core.ts) and the
 * WASM pre-validator (compiler.ts) to guarantee identical behavior
 * across all transformation code paths.
 */

import { PROPERTY_CATEGORY_MAP, PropertyCategory } from './property-types.js';

export const COLOR_STRING_KEYWORDS = new Set([
    'inherit', 'current', 'transparent', 'black', 'white', 'none',
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
    if (COLOR_STRING_KEYWORDS.has(value)) {return true;}
    if (value.startsWith('--')) {return true;} // CSS var: --my-color
    if (value.startsWith('#')) {return true;} // Hex: #ff0000
    if (value.startsWith('[') && value.endsWith(']')) {return true;} // Pre-bracketed
    // Color functions (auto-bracketed downstream)
    if (/^(rgb|hsl|oklch|color|hwb|lab|lch|oklab)\(/.test(value)) {return true;}
    // Color scale: blue-500, brand-500, brand-primary-500 — any word-number pattern
    if (/^[a-zA-Z][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*-\d+$/.test(value)) {return true;}
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
    if (slashIdx === -1) {return false;}
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
 * @returns A new object with invalid color strings removed.
 */
export function stripInvalidColorStrings(
    sz: Record<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sz)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Recurse into nested variants
            result[key] = stripInvalidColorStrings(value as Record<string, unknown>);
            continue;
        }
        if (
            typeof value === 'string' &&
            PROPERTY_CATEGORY_MAP[key] === PropertyCategory.COLOR
        ) {
            const strVal = value.replace(/!$/, '');
            if (hasSlashOpacity(strVal)) {
                if (process.env['NODE_ENV'] !== 'production' && typeof window === 'undefined') {
                    const slashIdx = strVal.indexOf('/');
                    const colorPart = strVal.slice(0, slashIdx);
                    const opPart = strVal.slice(slashIdx + 1);
                    console.warn(
                        `[csszyx] "${key}: '${strVal}'" — string slash opacity is not supported. ` +
                        `Use object form: { color: '${colorPart}', op: ${opPart} }.`,
                    );
                }
                continue; // strip from result
            }
            if (!isValidColorString(strVal)) {
                if (process.env['NODE_ENV'] !== 'production' && typeof window === 'undefined') {
                    console.warn(
                        `[csszyx] "${key}: '${strVal}'" is not a recognized color value and will be ignored. ` +
                        'Use a Tailwind color ("blue-500"), CSS variable ("--my-color"), ' +
                        'hex/rgb/hsl ("#ff0000"), or object form ({ color: "blue-500", op: 50 }).',
                    );
                }
                continue; // strip from result
            }
        }
        result[key] = value;
    }
    return result;
}
