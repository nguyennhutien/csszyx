/**
 * sz Codegen: Converts an sz object into a JSX expression string.
 *
 * { p: 4, bg: 'blue-500', hover: { bg: 'blue-600' } }
 * → "{{ p: 4, bg: 'blue-500', hover: { bg: 'blue-600' } }}"
 */

import { escapeSingleQuotedString } from '../utils/string-escape.js';

/**
 * Generate a JSX expression from sz object.
 * @param obj - The sz property object.
 * @returns {string} JSX expression string.
 */
export function generateSzExpression(obj: Record<string, unknown>): string {
    return `{${objectToString(obj)}}`;
}

/**
 * Generate an HTML attribute value string from sz object.
 * By default strips outer braces so the attribute reads naturally:
 *   sz="p: 4, bg: 'blue-500'"  (default, no braces)
 *   sz="{ p: 4, bg: 'blue-500' }"  (braces: true)
 *
 * The csszyx runtime auto-wraps the bare form before parsing,
 * so both formats are equivalent.
 *
 * @param obj - The sz property object.
 * @param braces - Wrap value in outer { } (default: false).
 * @returns {string} The attribute value string (no wrapping quotes).
 */
export function generateSzHtmlValue(obj: Record<string, unknown>, braces = false): string {
    const s = objectToString(obj);
    if (braces) {
        return s;
    }
    // Strip outermost braces: "{ ... }" → "..."
    if (s.startsWith('{ ') && s.endsWith(' }')) {
        return s.slice(2, -2);
    }
    if (s.startsWith('{') && s.endsWith('}')) {
        return s.slice(1, -1).trim();
    }
    return s;
}

/**
 * Generate an sz object literal string (without JSX expression braces).
 * Used by dynamic pattern handlers to produce array element strings.
 *
 * @example
 * generateSzObjectLiteral({ p: 4, bg: 'blue-500' })
 * // Returns: "{ p: 4, bg: 'blue-500' }"
 *
 * @param obj - The sz property object.
 * @returns {string} Object literal string.
 */
export function generateSzObjectLiteral(obj: Record<string, unknown>): string {
    return objectToString(obj);
}

/**
 * Convert an object to its string representation.
 * @param obj - The object to stringify.
 * @param indent - Current indentation level.
 * @returns {string} Formatted object string.
 */
function objectToString(obj: Record<string, unknown>, indent = 0): string {
    const entries = Object.entries(obj);
    if (entries.length === 0) {
        return '{}';
    }

    const spaces = ' '.repeat(indent);
    const innerSpaces = ' '.repeat(indent + 2);

    // Single entry: inline
    if (entries.length <= 2 && !hasDeepNesting(obj)) {
        const parts = entries.map(([k, v]) => `${formatKey(k)}: ${formatValue(v, indent)}`);
        return `{ ${parts.join(', ')} }`;
    }

    // Multiple entries: multi-line
    const lines = entries.map(
        ([k, v]) => `${innerSpaces}${formatKey(k)}: ${formatValue(v, indent + 2)},`,
    );
    return `{\n${lines.join('\n')}\n${spaces}}`;
}

/**
 * Checks if an object has nested objects that are not color-opacity or gradient.
 * @param obj - The object to check for deep nesting
 * @returns True if any value is a nested plain object
 */
function hasDeepNesting(obj: Record<string, unknown>): boolean {
    return Object.values(obj).some(
        v => typeof v === 'object' && v !== null && !isColorOpacityObj(v) && !isGradientObj(v),
    );
}

/**
 * Type guard for color+opacity objects like { color: 'blue-500', op: 50 }.
 * @param v - The value to check
 * @returns True if the value is a color-opacity object
 */
function isColorOpacityObj(v: unknown): v is { color: string; op: unknown } {
    return typeof v === 'object' && v !== null && 'color' in v && 'op' in v;
}

/**
 * Type guard for gradient objects like { gradient: 'linear', dir: 'to-r' }.
 * @param v - The value to check
 * @returns True if the value is a gradient object
 */
function isGradientObj(v: unknown): v is { gradient: string } {
    return typeof v === 'object' && v !== null && 'gradient' in v;
}

/**
 * Formats an object key, quoting if not a valid JS identifier.
 * @param key - The object key to format
 * @returns Formatted key string
 */
function formatKey(key: string): string {
    // Keys that are valid JS identifiers don't need quoting
    if (/^[a-z_$][\w$]*$/i.test(key)) {
        return key;
    }
    // Keys starting with @ or containing hyphens, dots, etc. need quotes
    return `'${escapeSingleQuotedString(key)}'`;
}

/**
 * Formats a value as a JS expression string for codegen output.
 * @param value - The value to format
 * @param indent - Current indentation level
 * @returns Formatted JS expression string
 */
function formatValue(value: unknown, indent: number): string {
    if (value === true) {
        return 'true';
    }
    if (value === false) {
        return 'false';
    }
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'number') {
        return String(value);
    }
    if (typeof value === 'string') {
        return `'${escapeSingleQuotedString(value)}'`;
    }

    if (Array.isArray(value)) {
        const items = value.map(v => formatValue(v, indent));
        return `[${items.join(', ')}]`;
    }

    if (typeof value === 'object') {
        return formatObjectValue(value as Record<string, unknown>, indent);
    }

    // Unsupported sz values must not leak function source or invalid Symbol text
    // into generated code. Keep the object shape while dropping the value.
    return 'undefined';
}

/**
 * Format structured color, gradient, or regular object values.
 * @param value - Object value to format.
 * @param indent - Current indentation level.
 * @returns JavaScript object expression source.
 */
function formatObjectValue(value: Record<string, unknown>, indent: number): string {
    if (isColorOpacityObj(value)) {
        const opacity =
            typeof value.op === 'number'
                ? String(value.op)
                : `'${escapeSingleQuotedString(String(value.op))}'`;
        return `{ color: '${escapeSingleQuotedString(String(value.color))}', op: ${opacity} }`;
    }
    if (!isGradientObj(value)) return objectToString(value, indent);
    const parts: string[] = [`gradient: '${escapeSingleQuotedString(value.gradient)}'`];
    if ('dir' in value) {
        const direction =
            typeof value.dir === 'number'
                ? String(value.dir)
                : `'${escapeSingleQuotedString(String(value.dir))}'`;
        parts.push(`dir: ${direction}`);
    }
    if ('in' in value) {
        parts.push(`in: '${escapeSingleQuotedString(String(value.in))}'`);
    }
    return `{ ${parts.join(', ')} }`;
}
