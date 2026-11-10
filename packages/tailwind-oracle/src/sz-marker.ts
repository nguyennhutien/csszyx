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
        code.includes('sz=') ||
        code.includes('szs=') ||
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
