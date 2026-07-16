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

import { _szcn } from './merge-classes.js';

/** Result of a runtime sz transform. */
interface TransformResult {
    className: string;
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
function transform(szProp: object): TransformResult {
    // `szProp` is typed `object` (not `SzObject`) so the public `SzInput` can stay
    // broad enough to accept a precise `SzProps`/`SzPropValue` forwarded from the
    // JSX boundary — a named type with specific keys is assignable to `object` but
    // not to `SzObject`'s `{ [k]: SzValue }` index signature. The runtime lowers
    // recognized keys and ignores the rest, so the cast is sound.
    const res = rawTransform(szProp as SzObject);
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
        return { className: mangled };
    }
    return res;
}

/**
 * Type for sz input — a pre-compiled class string, an sz object, a recursive
 * array of those, or a falsy guard (skipped).
 *
 * The object member is the broad `object` rather than `SzObject` so that a
 * precise `SzProps` / `SzPropValue` value (the type the JSX augmentation gives
 * `sz` on a host element) forwards into the runtime helpers without a cast: a
 * named type with specific keys is assignable to `object`, but not to
 * `SzObject`'s `{ [k: string]: SzValue }` index signature. The runtime lowers the
 * keys it recognizes and ignores the rest, so the looser input type is sound.
 */
export type SzInput = string | object | SzInput[] | null | undefined | false;

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
 * Resolve sz object(s) and/or class strings into a single className string,
 * mangle-aware. This is the PUBLIC, hand-written name for the otherwise
 * compiler-injected `_sz` helper (the `_` prefix marks compiler-generated code
 * you should not hand-author; `szr` is the one you call by hand).
 *
 * Reach for `szr` when you build a className from `szv` factory output or sz
 * objects — e.g. a split/layered design system that declares variants in a
 * module and resolves them at the leaf:
 *
 * ```ts
 * import { szr, szv } from '@csszyx/runtime';
 * const cardSz = szv({ variants: { pad: { lg: { p: 8 } } } });
 * const cls = szr(cardSz({ pad: 'lg' }), isWide && stackSz({ gap: 'xl' }));
 * ```
 *
 * Falsy inputs are skipped (clsx-style). `szr` CONCATENATES (keeps every class);
 * to combine with last-wins OVERRIDE on a same-utility conflict, use `szcn`.
 * `szr` accepts sz OBJECTS; `szcn` accepts className STRINGS.
 *
 * @param classes - sz objects, class strings, or falsy values (skipped).
 * @returns The resolved className string (mangled in a production build).
 */
export const szr: (...classes: SzInput[]) => string = _sz;

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
    assertSzDepth(depth);

    // Fast path: single string argument (most common case after compilation)
    if (classes.length === 1) {
        return resolveJoinedInput(classes[0], depth);
    }

    let result = '';
    for (const cls of classes) {
        result = appendClassName(result, resolveJoinedInput(cls, depth));
    }

    return result;
}

/**
 * Rejects nested sz input before it can exhaust the JavaScript call stack.
 * @param depth - The current recursion depth.
 */
function assertSzDepth(depth: number): void {
    if (depth >= MAX_SZ_DEPTH) {
        throw new SzDepthError();
    }
}

/**
 * Resolves one input using the concatenating semantics of {@link szJoin}.
 * @param input - The class input to resolve.
 * @param depth - The current recursion depth.
 * @returns The resolved class string, or an empty string for a falsy input.
 */
function resolveJoinedInput(input: SzInput, depth: number): string {
    if (!input) {
        return '';
    }
    if (typeof input === 'string') {
        return input;
    }
    if (Array.isArray(input)) {
        return szJoin(input, depth + 1);
    }
    return transform(input).className;
}

/**
 * Appends a non-empty class string with exactly one separating space.
 * @param current - The class string accumulated so far.
 * @param next - The next resolved class string.
 * @returns The combined class string.
 */
function appendClassName(current: string, next: string): string {
    if (!next) {
        return current;
    }
    return current ? `${current} ${next}` : next;
}

/**
 * Merges className strings with mangle-aware, utility-group last-wins semantics.
 *
 * Useful when combining multiple className sources that may overlap.
 *
 * @param {...SzInput[]} classes - Class names or SzObjects to merge
 * @returns {string} Merged className string with later utility conflicts winning
 *
 * @example
 * ```typescript
 * _szMerge('gap-2 p-4', 'gap-8')
 * // Returns: "p-4 gap-8"
 *
 * _szMerge({ p: 4 }, { p: 2, m: 4 })
 * // Returns: "p-2 m-4"
 * ```
 */
export function _szMerge(...classes: SzInput[]): string {
    return _szcn(szJoin(classes, 0));
}

/**
 * Normalizes one dynamic element of a compiled sz array into a class string
 * for `szcn`.
 *
 * The build rewrites `sz={[...]}` arrays with runtime elements into
 * `szcn(..., _szPart(<expr>), ...)`: the compiler cannot know whether the
 * expression yields a class string (a forwarded `szsc` slot), an sz object,
 * or a falsy guard — this helper resolves whichever arrives so `szcn` only
 * ever group-merges strings. Strings pass through untouched; everything else
 * (sz objects, nested arrays, falsy) goes through `_szMerge`'s existing
 * compile-and-join.
 *
 * @param {unknown} value - One runtime array element.
 * @returns {string} The element as a class string (`''` for falsy).
 *
 * @example
 * ```typescript
 * _szPart('text-lg')          // "text-lg"  (string passthrough)
 * _szPart({ p: 4 })           // "p-4"      (compiled)
 * _szPart(undefined)          // ""
 * ```
 */
export function _szPart(value: unknown): string {
    return typeof value === 'string' ? value : _szMerge(value as SzInput);
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
