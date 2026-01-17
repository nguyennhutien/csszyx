/**
 * @csszyx/runtime/lite - Ultra-minimal runtime helpers.
 *
 * This is the lightweight entry point for csszyx runtime, containing only
 * the essential helpers needed for className composition. All sz objects
 * are pre-compiled to strings at build time, so this module is string-only.
 *
 * Bundle size target: < 500 bytes (minified + gzipped)
 *
 * @module @csszyx/runtime/lite
 */

/**
 * Type for sz input - string-only (objects are pre-compiled at build time).
 */
export type SzInput = string | null | undefined | false;

/**
 * Zero-overhead className passthrough/concatenation.
 *
 * @param {...SzInput[]} classes - Class names to concatenate
 * @returns {string} Combined className string
 *
 * @example
 * ```typescript
 * _sz('p-4 bg-red-500') // passthrough
 * _sz('base', isActive && 'active') // conditional
 * ```
 */
export function _sz(...classes: SzInput[]): string {
    if (classes.length === 1) {
        return classes[0] || '';
    }

    let result = '';
    let needsSpace = false;

    for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        if (!cls) {continue;}
        if (needsSpace) {result += ' ';}
        result += cls;
        needsSpace = true;
    }

    return result;
}

/**
 * Conditional className helper.
 *
 * @param {boolean} condition - Condition to evaluate
 * @param {SzInput} truthyValue - Value when true
 * @param {SzInput} falsyValue - Value when false
 * @returns {string} Resolved className
 *
 * @example
 * ```typescript
 * _szIf(isActive, 'bg-green-500', 'bg-gray-500')
 * ```
 */
export function _szIf(
    condition: boolean,
    truthyValue: SzInput,
    falsyValue?: SzInput,
): string {
    return (condition ? truthyValue : falsyValue) || '';
}

/**
 * Two-argument optimized concatenation.
 * @param a - first class string
 * @param b - second class string
 * @returns concatenated class string
 */
export function _sz2(a: string, b: string): string {
    if (!a) {return b || '';}
    if (!b) {return a;}
    return a + ' ' + b;
}

/**
 * Resolves a dynamic color value to a CSS-compatible string.
 * Maps Tailwind color names to CSS custom properties, passes through raw CSS values.
 *
 * @param v - Color value (Tailwind name, CSS color, or CSS variable)
 * @returns CSS-compatible color string
 *
 * @example
 * __szColorVar('blue-500')  // → 'var(--color-blue-500)'
 * __szColorVar('#ff0')      // → '#ff0'
 * __szColorVar('--my-var')  // → 'var(--my-var)'
 */
export function __szColorVar(v: string): string {
    if (v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl') || v.startsWith('oklch')) {return v;}
    if (v.startsWith('--')) {return `var(${v})`;}
    return `var(--color-${v})`;
}
