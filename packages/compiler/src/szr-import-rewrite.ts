/**
 * Decision spec for the szr import rewrite, shared by the TypeScript lanes
 * (the Rust lane hand-mirrors it; the cross-engine suite locks all three to
 * the same verdicts).
 *
 * `import { szr } from '@csszyx/runtime'` ships the ~12.6 KB gz browser
 * transform because the barrel's szr must handle sz OBJECTS standalone. When
 * a file provably never passes szr anything but strings, the compiler rewrites
 * the import to the `/core` entry, whose szr is string-first and compiler-free
 * (~3 KB). The proof is conservative by construction: every uncertain shape
 * fails it, and a failed proof simply keeps today's import — the rewrite is
 * monotone, never worse.
 *
 * The proof has two halves:
 *
 * 1. **Argument safety** (per engine, AST-level): every `szr(...)` argument is
 *    an expression that cannot evaluate to a truthy non-string — string or
 *    template literal, `false`/`null`/`undefined`, `&&` whose right side is
 *    safe (a falsy left short-circuits to a skipped falsy), `||`/`??`/ternary
 *    whose reachable results are all safe, or an array of safe elements.
 *
 * 2. **Reference accounting** (text-level, engine-independent): the word `szr`
 *    must occur in the source exactly `1 + proven calls` times — once for the
 *    import specifier, once per call. Any other occurrence (a member access, a
 *    shadowing declaration, szr passed as a value, an alias, a comment, a
 *    string, `eval`) inflates the count and fails the proof. Overcounting can
 *    only suppress a rewrite, never cause one, which is why plain text is
 *    sufficient — and it makes the cross-engine contract trivial, since all
 *    three lanes count the same bytes.
 *
 * @module szr-import-rewrite
 */

/**
 * Import sources eligible for the rewrite, mapped to their slim targets.
 *
 * Same-package subpaths ONLY: an app importing from `csszyx` may not resolve
 * `@csszyx/runtime` under strict node_modules layouts, so each source maps
 * within its own package.
 */
export const SZR_IMPORT_REWRITE_TARGETS: Readonly<Record<string, string>> = {
    '@csszyx/runtime': '@csszyx/runtime/core',
    csszyx: 'csszyx/core',
};

/**
 * True when the character continues an identifier around `szr`.
 *
 * @param char - Neighbouring character (empty at a source edge).
 * @returns Whether it is an ASCII identifier character.
 */
function isIdentifierChar(char: string): boolean {
    return /[\w$]/.test(char);
}

/**
 * Count word-boundary occurrences of `szr` in the raw source.
 *
 * A boundary here is "not an ASCII identifier character". A non-ASCII
 * identifier continuation (`szrΩ`) still counts as a boundary, which
 * OVERCOUNTS and therefore fails the proof — the safe direction.
 *
 * @param source - Original file text.
 * @returns Number of standalone `szr` words.
 */
export function countSzrWordOccurrences(source: string): number {
    let count = 0;
    let from = 0;
    while (true) {
        const at = source.indexOf('szr', from);
        if (at === -1) {
            return count;
        }
        const before = at === 0 ? '' : source[at - 1];
        const after = at + 3 >= source.length ? '' : source[at + 3];
        if (
            (before === '' || !isIdentifierChar(before)) &&
            (after === '' || !isIdentifierChar(after))
        ) {
            count += 1;
        }
        from = at + 3;
    }
}

/**
 * Final verdict from the two proof halves.
 *
 * @param wordOccurrences - Result of {@link countSzrWordOccurrences}.
 * @param provenCallCount - Direct `szr(...)` calls whose every argument passed
 * the engine's safety check.
 * @param sawUnsafeCall - Whether any direct `szr(...)` call had an argument
 * that failed the safety check.
 * @returns Whether the import may be rewritten to the core entry.
 */
export function szrRewriteApproved(
    wordOccurrences: number,
    provenCallCount: number,
    sawUnsafeCall: boolean,
): boolean {
    return !sawUnsafeCall && wordOccurrences === 1 + provenCallCount;
}
