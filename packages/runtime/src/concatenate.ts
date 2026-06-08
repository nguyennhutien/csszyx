/**
 * Zero-allocation className concatenation helper.
 *
 * This module provides the runtime helper for composing dynamic className
 * strings with minimal overhead. The _sz() function is designed for
 * performance-critical scenarios where className composition happens
 * frequently.
 *
 * @module @csszyx/runtime/concatenate
 */

import { type SzObject, transform } from '@csszyx/compiler/browser';

/**
 * Type for sz input - can be a pre-compiled string, SzObject, or recursive array.
 */
export type SzInput = string | SzObject | SzInput[] | null | undefined | false;

/**
 * Zero-overhead className passthrough/concatenation helper.
 *
 * When the compiler pre-transforms sz objects to strings at build time,
 * this function simply passes through the string (zero overhead).
 * For runtime usage, it can also concatenate multiple class strings
 * or transform SzObjects on-the-fly.
 *
 * @param {...SzInput[]} classes - Class names or SzObjects to concatenate
 * @returns {string} Combined className string
 *
 * @example
 * ```typescript
 * // Passthrough (from compiler) - zero overhead
 * _sz('p-4 bg-red-500')
 * // Returns: "p-4 bg-red-500"
 *
 * // With conditionals
 * _sz('base', isActive && 'active', error && 'error')
 * // Returns: "base active" (if isActive is true, error is false)
 *
 * // With SzObject (runtime transform)
 * _sz({ p: 4, bg: 'red-500' })
 * // Returns: "p-4 bg-red-500"
 * ```
 */
export function _sz(...classes: SzInput[]): string {
    // Fast path: single string argument (most common case after compilation)
    if (classes.length === 1) {
        const cls = classes[0];
        if (typeof cls === 'string') {
            return cls;
        }
        if (!cls) {
            return '';
        }
        if (Array.isArray(cls)) {
            return _sz(...(cls as SzInput[]));
        }
        const res = transform(cls);
        return typeof res === 'string' ? res : res.className;
    }

    let result = '';
    let needsSpace = false;

    for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];

        // Skip falsy values
        if (!cls) {
            continue;
        }

        if (Array.isArray(cls)) {
            const str = _sz(...(cls as SzInput[]));
            if (!str) {
                continue;
            }
            if (needsSpace) {
                result += ' ';
            }
            result += str;
            needsSpace = true;
            continue;
        }

        // Transform SzObject to string if needed
        const res = typeof cls === 'string' ? cls : transform(cls);
        const str = typeof res === 'string' ? res : res.className;
        if (!str) {
            continue;
        }

        // Add space separator if needed
        if (needsSpace) {
            result += ' ';
        }
        result += str;
        needsSpace = true;
    }

    return result;
}

/**
 * Conditionally applies className based on a condition.
 *
 * Supports both pre-compiled strings and SzObjects for dynamic styling.
 * This is the recommended helper for conditional class application.
 *
 * @param {boolean} condition - Whether to apply the truthy value
 * @param {SzInput} truthyValue - ClassName or SzObject when condition is true
 * @param {SzInput} falsyValue - ClassName or SzObject when condition is false
 * @returns {string} The resolved className string
 *
 * @example
 * ```typescript
 * // With strings (pre-compiled)
 * _szIf(isActive, 'bg-green-500', 'bg-gray-500')
 * // Returns: "bg-green-500" if isActive, "bg-gray-500" otherwise
 *
 * // With SzObjects (runtime transform)
 * _szIf(isActive, { bg: 'green-500' }, { bg: 'gray-500' })
 * // Returns: "bg-green-500" if isActive, "bg-gray-500" otherwise
 *
 * // Without fallback
 * _szIf(isActive, { bg: 'green-500' })
 * // Returns: "bg-green-500" if isActive, "" otherwise
 * ```
 */
export function _szIf(condition: boolean, truthyValue: SzInput, falsyValue?: SzInput): string {
    const value = condition ? truthyValue : falsyValue;

    if (!value) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return _sz(...(value as SzInput[]));
    }
    const res = transform(value);
    return typeof res === 'string' ? res : res.className;
}

/**
 * Applies className based on multiple conditions (switch-like).
 *
 * Returns the className for the first truthy condition, or the default.
 * Supports both strings and SzObjects.
 *
 * @param {Array<[boolean, SzInput]>} conditions - Array of [condition, value] tuples
 * @param {SzInput} defaultValue - Default value if no conditions match
 * @returns {string} The matched className or default
 *
 * @example
 * ```typescript
 * _szSwitch([
 *     [status === 'success', { text: 'green-500' }],
 *     [status === 'error', { text: 'red-500' }],
 *     [status === 'warning', { text: 'yellow-500' }]
 * ], { text: 'gray-500' })
 * ```
 */
export function _szSwitch(
    conditions: Array<[boolean, SzInput]>,
    defaultValue: SzInput = '',
): string {
    for (let i = 0; i < conditions.length; i++) {
        const [condition, value] = conditions[i];
        if (condition) {
            if (!value) {
                return '';
            }
            if (typeof value === 'string') {
                return value;
            }
            if (Array.isArray(value)) {
                return _sz(...(value as SzInput[]));
            }
            const res = transform(value);
            return typeof res === 'string' ? res : res.className;
        }
    }

    if (!defaultValue) {
        return '';
    }
    if (typeof defaultValue === 'string') {
        return defaultValue;
    }
    if (Array.isArray(defaultValue)) {
        return _sz(...(defaultValue as SzInput[]));
    }
    const res = transform(defaultValue);
    return typeof res === 'string' ? res : res.className;
}

/**
 * Merges className strings, removing duplicates.
 *
 * Useful when combining multiple className sources that may overlap.
 *
 * @param {...SzInput[]} classes - Class names or SzObjects to merge
 * @returns {string} Merged className string with duplicates removed
 *
 * @example
 * ```typescript
 * _szMerge('a b c', 'b c d', 'c d e')
 * // Returns: "a b c d e"
 *
 * _szMerge({ p: 4 }, { p: 2, m: 4 })
 * // Returns: "p-4 p-2 m-4" (duplicates from different calls are kept)
 * ```
 */
export function _szMerge(...classes: SzInput[]): string {
    const seen = new Set<string>();
    const result: string[] = [];

    for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        if (!cls) {
            continue;
        }

        if (Array.isArray(cls)) {
            const str = _szMerge(...(cls as SzInput[]));
            if (!str) {
                continue;
            }
            const parts = str.split(/\s+/);
            for (let j = 0; j < parts.length; j++) {
                const part = parts[j];
                if (part && !seen.has(part)) {
                    seen.add(part);
                    result.push(part);
                }
            }
            continue;
        }

        const res = typeof cls === 'string' ? cls : transform(cls);
        const str = typeof res === 'string' ? res : res.className;
        if (!str) {
            continue;
        }

        const parts = str.split(/\s+/);
        for (let j = 0; j < parts.length; j++) {
            const part = parts[j];
            if (part && !seen.has(part)) {
                seen.add(part);
                result.push(part);
            }
        }
    }

    return result.join(' ');
}

/**
 * Performance-optimized variant of _sz() for exactly 2 arguments.
 *
 * Faster than the variadic version when the number of classes is known
 * at compile time. Use for hot paths.
 *
 * @param {string} a - First className
 * @param {string} b - Second className
 * @returns {string} Combined className string
 *
 * @example
 * ```typescript
 * _sz2('a', 'b')
 * // Returns: "a b"
 * ```
 */
export function _sz2(a: string, b: string): string {
    if (!a) {
        return b || '';
    }
    if (!b) {
        return a;
    }
    return `${a} ${b}`;
}

/**
 * Performance-optimized variant for exactly 3 arguments.
 *
 * @param {string} a - First className
 * @param {string} b - Second className
 * @param {string} c - Third className
 * @returns {string} Combined className string
 */
export function _sz3(a: string, b: string, c: string): string {
    let result = '';
    let needsSpace = false;

    if (a) {
        result = a;
        needsSpace = true;
    }
    if (b) {
        if (needsSpace) {
            result += ' ';
        }
        result += b;
        needsSpace = true;
    }
    if (c) {
        if (needsSpace) {
            result += ' ';
        }
        result += c;
    }

    return result;
}
