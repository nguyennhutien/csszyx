/**
 * @csszyx/runtime/lite - Ultra-minimal runtime helpers.
 *
 * This is the lightweight entry point for csszyx runtime, containing only
 * the essential helpers needed for className composition. All sz objects
 * are pre-compiled to strings at build time, so this module is string-only.
 *
 * Bundle size target: < 500 bytes (minified + gzipped)
 *
 * __szColorVar is imported from @csszyx/compiler/color-var and inlined at
 * build time by tsup (noExternal). Zero runtime deps — single source of truth.
 *
 * @module @csszyx/runtime/lite
 */

// Inlined at build time — NOT a runtime dep. See tsup.config.ts.
export { __szColorVar } from '@csszyx/compiler/color-var';
export { __szSpacingVar, __szUnitVar } from '@csszyx/compiler/spacing-var';

/**
 * Input to the lite runtime helpers: a pre-compiled class string or a falsy
 * guard (skipped). The lite path has no compiler, so it never accepts objects —
 * unlike the full `SzInput` from `@csszyx/runtime`, which also takes sz objects.
 * Named distinctly so the two do not look interchangeable.
 */
export type SzStringInput = string | null | undefined | false;

/**
 * @deprecated Renamed to {@link SzStringInput} — the lite helpers accept only
 * pre-compiled class strings, and the bare name collided with the object-accepting
 * `SzInput` from `@csszyx/runtime`. This alias is kept for back-compat.
 */
export type SzInput = SzStringInput;

/**
 * Dev-only guard: throw when a plain object reaches a string-only helper.
 * Compiled sz props are always strings; an object here means the compiler
 * hit an unhandled pattern and fell back to _sz(objectExpr).
 *
 * Dead-code eliminated in production builds (process.env.NODE_ENV check).
 * @param cls - Value to check; expected to be a string, null, undefined, or false
 * @param fnName - Name of the calling helper, included in the error message
 */
function assertNotObject(cls: unknown, fnName: string): void {
    if (cls !== null && cls !== undefined && cls !== false && typeof cls !== 'string') {
        throw new Error(
            `[csszyx] ${fnName}() received a plain object — the compiler could not resolve this sz prop at build time.\n` +
                '\n' +
                "Common cause:   sz={{ ...(cond ? varA : varB), key: 'val' }}\n" +
                "Fix:            sz={[cond ? varA : varB, { key: 'val' }]}\n" +
                '\n' +
                `Received: ${JSON.stringify(cls)}`,
        );
    }
}

/**
 * Zero-overhead className passthrough/concatenation.
 *
 * @param {...SzStringInput[]} classes - Class names to concatenate
 * @returns {string} Combined className string
 *
 * @example
 * ```typescript
 * _sz('p-4 bg-red-500') // passthrough
 * _sz('base', isActive && 'active') // conditional
 * ```
 */
export function _sz(...classes: SzStringInput[]): string {
    if (classes.length === 1) {
        if (process.env.NODE_ENV !== 'production') {
            assertNotObject(classes[0], '_sz');
        }
        return classes[0] || '';
    }

    let result = '';
    let needsSpace = false;

    for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        if (process.env.NODE_ENV !== 'production') {
            assertNotObject(cls, '_sz');
        }
        if (!cls) {
            continue;
        }
        if (needsSpace) {
            result += ' ';
        }
        result += cls;
        needsSpace = true;
    }

    return result;
}

/**
 * Merges className strings from compiled sz props, deduplicating exact tokens.
 *
 * This lite-entry compatibility helper intentionally does not ship the full
 * utility classifier used by root-runtime `_szMerge`/`szcn`; importing that
 * classifier would turn the ~2 kB lite entry into the full runtime graph.
 *
 * Emitted by the compiler for sz={[varA, cond && varB, ...]} when at least one
 * element is a runtime conditional. All arguments must be pre-compiled strings
 * (the compiler resolves each element to a string before passing it here).
 *
 * @param {...SzStringInput[]} classes - Pre-compiled class strings to merge
 * @returns {string} Merged className string with duplicate tokens removed
 */
export function _szMerge(...classes: SzStringInput[]): string {
    const seen = new Set<string>();
    const result: string[] = [];

    for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        if (process.env.NODE_ENV !== 'production') {
            assertNotObject(cls, '_szMerge');
        }
        if (!cls) {
            continue;
        }
        for (const token of (cls as string).split(' ')) {
            if (token && !seen.has(token)) {
                seen.add(token);
                result.push(token);
            }
        }
    }

    return result.join(' ');
}

/**
 * Two-argument optimized concatenation.
 * @param a - first class string
 * @param b - second class string
 * @returns concatenated class string
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
