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

import {
    MAX_SZ_DEPTH,
    transform as rawTransform,
    SzDepthError,
    type SzObject,
} from '@csszyx/compiler/browser';

/** Result of a runtime sz transform: the className plus any style attributes. */
interface TransformResult {
    className: string;
    attributes: Record<string, string>;
}

/** A frozen map of original class names to their mangled SSR equivalents. */
type RuntimeMangleMap = Readonly<Record<string, string>>;

/** Global slots that may expose the SSR/runtime mangle map. */
interface CsszyxMangleGlobals {
    __csszyx_ssr_mangle_map?: RuntimeMangleMap;
    __csszyx?: {
        mangleMap?: RuntimeMangleMap;
    };
}

/**
 * Wraps rawTransform to apply runtime class-name mangling when a mangle map is
 * present on the global (SSR) or window object.
 * @param szProp - The sz object to transform into a className.
 * @returns The transform result, with class names mangled when a map is active.
 */
function transform(szProp: SzObject): TransformResult {
    const res = rawTransform(szProp);
    const className = res.className;
    if (!className) {
        return res;
    }

    const globals = globalThis as typeof globalThis & CsszyxMangleGlobals;
    const ssrMangleMap = globals.__csszyx_ssr_mangle_map || globals.__csszyx?.mangleMap;
    const browserMangleMap =
        typeof window !== 'undefined'
            ? (window as Window & CsszyxMangleGlobals).__csszyx?.mangleMap
            : undefined;
    const activeMangleMap = ssrMangleMap || browserMangleMap;

    if (activeMangleMap) {
        const mangled = className
            .split(/\s+/)
            .filter(Boolean)
            .map((c: string) => activeMangleMap[c] || c)
            .join(' ');
        return {
            className: mangled,
            attributes: res.attributes,
        };
    }
    return res;
}

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
    return szJoin(classes, 0);
}

/**
 * Depth-tracked worker for {@link _sz}. Nested arrays recurse with an incremented
 * depth so a deeply nested array (`[[[[…]]]]`, e.g. from untrusted data) is
 * bounded by {@link MAX_SZ_DEPTH} instead of overflowing the call stack.
 *
 * @param classes - the class inputs to join.
 * @param depth - the current recursion depth.
 * @returns the joined className string.
 */
function szJoin(classes: SzInput[], depth: number): string {
    if (depth >= MAX_SZ_DEPTH) {
        throw new SzDepthError();
    }

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
            return szJoin(cls as SzInput[], depth + 1);
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
            const str = szJoin(cls as SzInput[], depth + 1);
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
    return szMergeJoin(classes, 0);
}

/**
 * Depth-tracked worker for {@link _szMerge}. Bounds nested-array recursion by
 * {@link MAX_SZ_DEPTH} so untrusted deeply nested input cannot overflow the stack.
 *
 * @param classes - the class inputs to join.
 * @param depth - the current recursion depth.
 * @returns the joined className string.
 */
function szMergeJoin(classes: SzInput[], depth: number): string {
    if (depth >= MAX_SZ_DEPTH) {
        throw new SzDepthError();
    }

    const seen = new Set<string>();
    const result: string[] = [];

    for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        if (!cls) {
            continue;
        }

        if (Array.isArray(cls)) {
            const str = szMergeJoin(cls as SzInput[], depth + 1);
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
