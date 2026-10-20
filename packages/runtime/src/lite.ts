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

import { CsszyxError } from '@csszyx/compiler/errors';
import { LITE_SZ_OBJECT, szRender } from '@csszyx/compiler/report';

// Inlined at build time — NOT a runtime dep. See tsup.config.ts.
export { __szBoolClass } from '@csszyx/compiler/bool-class';
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
 * Dev-only guard: throw when a plain object reaches a string-only helper.
 * Compiled sz props are always strings; an object here means the compiler
 * hit an unhandled pattern and fell back to _sz(objectExpr).
 *
 * Dead-code eliminated in production builds: every call sits under a
 * `process.env.NODE_ENV` check, so a bundler drops the calls, this function
 * and the registry's words for `lite-sz-object` with them.
 * @param cls - Value to check; expected to be a string, null, undefined, or false
 * @param fnName - Name of the calling helper, included in the error message
 * @throws {CsszyxError} `lite-sz-object`, when `cls` is an object.
 */
function assertNotObject(cls: unknown, fnName: string): void {
    if (cls !== null && cls !== undefined && cls !== false && typeof cls !== 'string') {
        const args = { fnName, received: JSON.stringify(cls) };
        throw new CsszyxError({
            code: 'lite-sz-object',
            args,
            message: szRender({ diagnostic: LITE_SZ_OBJECT, args }),
        });
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
 * @internal Called by generated code, not written by hand. The three
 * engines share these names as an ABI: a changed shape makes classes
 * vanish where a build and a runtime differ in version, so a new shape
 * gets a new name.
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

    for (const cls of classes) {
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
 * @internal Called by generated code, not written by hand. The three
 * engines share these names as an ABI: a changed shape makes classes
 * vanish where a build and a runtime differ in version, so a new shape
 * gets a new name.
 */
export function _szMerge(...classes: SzStringInput[]): string {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const cls of classes) {
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
 * @internal Called by generated code, not written by hand. The three
 * engines share these names as an ABI: a changed shape makes classes
 * vanish where a build and a runtime differ in version, so a new shape
 * gets a new name.
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
