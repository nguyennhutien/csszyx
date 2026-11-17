/**
 * The cheap text tests that decide whether the build looks at a module.
 *
 * Two gates, one nested in the other. {@link moduleMayHoldSz} decides whether
 * the transform lowers a module; {@link fileMayContainSafelistableSz} decides
 * whether the prescan reads it for the safelist, and is what `csszyx check`
 * reads through. The second is built from the first, so a module the
 * transform lowers is always one the prescan and the check read too.
 *
 * @module
 */

/*
 * A JSX attribute by name: the name, not continuing a longer one (`data-sz`,
 * `xsz`), then JavaScript whitespace (`\s`) on both sides of an `=`, then a
 * value, which opens with `{`, `"`, `'` or `<` (an expression, a string, an
 * element) or with the `/` of a comment before it; that keeps `sz == x` and
 * `const sz = 1` out. A name continues through Alphabetic and Numeric
 * characters, `_`, `$`, `-` and the joiners ZWNJ/ZWJ, the set the engine's
 * `char::is_alphanumeric` names. `:` does not continue
 * a name: Vue binds an attribute as `:sz` or `v-bind:sz`, and that is `sz`.
 *
 * A text scan, not a parse: an attribute spelled in a string or a comment
 * counts too. Every caller gates or bails on the answer, where a match too
 * many costs one file the compiler and a match too few ships it unlowered.
 * The engine's `jsx_attributes` (`js_text.rs`) reads the same way; both are
 * held to `packages/core/tests/fixtures/jsx-attribute-cases.json`.
 *
 * One exported literal per name, so a bundle carries only the names it reads.
 * Irregexp skips to each candidate with a Boyer-Moore table, where an
 * `indexOf` loop stops at every `s`: over this repository's 1,332 modules
 * `moduleMayHoldSz` took 9.6 µs a module this way, 11.6 as a loop and 10.5
 * as the `includes('sz=')` it replaced. Each is linear: a match can only
 * start at the name, and `\s*` backtracks over the whitespace behind it.
 */
/** The JSX attribute `sz` ({@link jsxAttributes}). */
export const JSX_SZ_ATTRIBUTE: RegExp =
    /(?<![\p{Alphabetic}\p{N}\p{Join_Control}_$-])sz\s*=\s*(?=[{"'</])/gu;
/** The JSX attribute `szs`. */
export const JSX_SZS_ATTRIBUTE: RegExp =
    /(?<![\p{Alphabetic}\p{N}\p{Join_Control}_$-])szs\s*=\s*(?=[{"'</])/gu;
/** The JSX attribute `class`. */
export const JSX_CLASS_ATTRIBUTE: RegExp =
    /(?<![\p{Alphabetic}\p{N}\p{Join_Control}_$-])class\s*=\s*(?=[{"'</])/gu;
/** The JSX attribute `className`. */
export const JSX_CLASS_NAME_ATTRIBUTE: RegExp =
    /(?<![\p{Alphabetic}\p{N}\p{Join_Control}_$-])className\s*=\s*(?=[{"'</])/gu;

/** One JSX attribute {@link jsxAttributes} found. */
export interface JsxAttributeAt {
    /** Where its name starts, in UTF-16 units. */
    start: number;
    /** Where its value starts. */
    value: number;
}

/**
 * Each JSX attribute an attribute pattern finds in `text`, in text order.
 *
 * @param text - Source text.
 * @param attribute - One of the `JSX_*_ATTRIBUTE` patterns.
 * @returns Where each starts and where its value starts.
 */
export function jsxAttributes(text: string, attribute: RegExp): JsxAttributeAt[] {
    return Array.from(text.matchAll(attribute), match => ({
        start: match.index,
        value: match.index + match[0].length,
    }));
}

/**
 * Whether `text` holds the JSX attribute ({@link jsxAttributes}). `search`
 * reads a global pattern from the start and leaves it as it was.
 *
 * @param text - Source text.
 * @param attribute - One of the `JSX_*_ATTRIBUTE` patterns.
 * @returns True when one is there.
 */
export function hasJsxAttribute(text: string, attribute: RegExp): boolean {
    return text.search(attribute) !== -1;
}

/**
 * Whether a module may hold an `sz` value or an `szr()` call, read cheaply
 * before the compiler runs.
 *
 * szr-only modules (no sz attribute) once skipped the compiler entirely,
 * which also skipped the szr import rewrite and its fallback diagnostics.
 * The test is deliberately loose: a false positive only costs one file the
 * compiler pass, which then changes nothing.
 *
 * @param code - The module's source.
 * @returns True when the compiler should look at it.
 */
export function moduleMayHoldSz(code: string): boolean {
    return (
        hasJsxAttribute(code, JSX_SZ_ATTRIBUTE) ||
        hasJsxAttribute(code, JSX_SZS_ATTRIBUTE) ||
        /\bsz\s*:\s*["'{]/.test(code) ||
        code.includes('sz: "') ||
        code.includes('szr(')
    );
}

/**
 * Whether a file's text may contain csszyx classes the prescan should extract
 * into the safelist: every module {@link moduleMayHoldSz} lets the transform
 * lower, and more. A `szv(...)` declaration produces safelistable classes (the
 * compiler extracts every variant from the config), and a layout component
 * built as a prop API resolves szv via `_sz(...)` with no `sz=` in the file, so
 * gating on `sz` alone left those variants unsafelisted (silent dead classes).
 * `szv(` is a precise, csszyx-owned token, so including it costs at most an
 * extra file transform (the prescan is fail-open: when in doubt, scan).
 *
 * The plugin's prescan and `csszyx check` both gate on it, so `check` never
 * lowers, and never reports on, a file the build does not parse.
 *
 * @param content - The source file text.
 * @returns true when the file should be prescanned for safelist extraction.
 */
export function fileMayContainSafelistableSz(content: string): boolean {
    return (
        moduleMayHoldSz(content) ||
        content.includes('sz:') ||
        content.includes('szv(') ||
        // dynamic() literal args are extracted for the safelist, but a module
        // containing ONLY dynamic() calls never passed this gate — the
        // engine-parity harness caught its classes missing on all engines.
        content.includes('dynamic(')
    );
}
