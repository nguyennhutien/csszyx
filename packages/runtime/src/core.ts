/**
 * String-first className helpers, published as `@csszyx/runtime/core`.
 *
 * This is the single implementation of `_sz`/`szr`/`_szMerge`/`_szPart` (the
 * back-compat `@csszyx/runtime` entry wraps these same functions). The object
 * branch resolves through the lowering slot instead of a static compiler
 * import, so a bundle where no sz object can reach a helper at runtime ships
 * a few hundred bytes instead of the ~12.6 KB gz browser transform.
 *
 * Object support arrives one of two ways:
 * - the bundler plugin injects `import '@csszyx/runtime/lowering'` into files
 *   where an object can flow;
 * - the back-compat `@csszyx/runtime` entry registers eagerly on first call,
 *   preserving the historical "szr just works" behaviour for code outside the
 *   plugin pipeline.
 *
 * An object arriving with no lowerer registered is a loud, actionable error —
 * never silently dropped styling.
 *
 * @module @csszyx/runtime/core
 */

import { MAX_SZ_DEPTH, SzDepthError } from '@csszyx/compiler/browser';

import { getSzLowering } from './lowering-slot.js';

export {
    __szvPick,
    __szvPick1,
    type SzvCompiledTable,
    type SzvPickSelection,
} from './szv-pick.js';

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
 * // With SzObject (runtime transform; needs the lowering module)
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
    return lowerObject(input);
}

/**
 * Lower one sz object through the registered lowerer.
 *
 * @param input - The sz object.
 * @returns The lowered className.
 * @throws When no lowering module is loaded — a silent empty string here would
 * be invisibly dropped styling, the one failure mode this package never
 * accepts.
 */
function lowerObject(input: object): string {
    const lower = getSzLowering();
    if (lower === null) {
        throw new Error(
            '[csszyx] a string helper received an sz OBJECT but the object-lowering ' +
                'module is not loaded, so it cannot be turned into class names.\n' +
                'The csszyx bundler plugin loads it automatically for files that can ' +
                'pass objects at runtime. Outside the plugin pipeline (unit tests, ' +
                "scripts), add once at startup:\n    import '@csszyx/runtime/lowering';",
        );
    }
    return lower(input);
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
