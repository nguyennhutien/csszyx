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
 *    shadowing declaration, szr passed as a value, an alias, a string, `eval`)
 *    inflates the count and fails the proof. Comments are excluded via the
 *    engine's own parser spans — they are erased at runtime, and real code
 *    documents `szr` by name. Overcounting can only suppress a rewrite, never
 *    cause one, which is why plain text is sufficient — and it makes the
 *    cross-engine contract trivial, since all three lanes count the same
 *    bytes.
 *
 * @module szr-import-rewrite
 */

import { type SzrArgumentAnalysisOf, szrArgumentProven } from './szv-precompile.js';

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
 * Count word-boundary occurrences of `szr` outside comments.
 *
 * Same subtraction contract as `countWordOccurrencesOutsideComments` in the
 * szv precompile spec: parser-derived spans, exact because comment delimiters
 * are non-identifier characters.
 *
 * @param source - Original file text.
 * @param comments - Comment spans from the engine's parser.
 * @returns Number of standalone `szr` words outside comments.
 */
export function countSzrWordOccurrencesOutsideComments(
    source: string,
    comments: ReadonlyArray<{ start: number; end: number }>,
): number {
    let count = countSzrWordOccurrences(source);
    for (const comment of comments) {
        count -= countSzrWordOccurrences(source.slice(comment.start, comment.end));
    }
    return count;
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

/**
 * The whole-file szr proof, shared by both TypeScript lanes.
 *
 * Every direct `szr(...)` call must have an analysis per argument, every
 * argument must be proven (string shape, factories rewritten), and the
 * reference accounting must balance. The lanes previously each carried this
 * prologue inline, which is exactly the kind of decision logic a
 * `build.parser` flip must not be able to change one-sidedly.
 *
 * @param szrCalls - Direct `szr(...)` calls collected by the lane.
 * @param szrArgumentAnalyses - Per-call argument analyses.
 * @param replacedCalls - Node-identity set of rewritten factory calls.
 * @param source - Original file text.
 * @param commentSpans - Comment spans, for comment-excluded accounting.
 * @returns Whether the import may be rewritten to the core entry.
 */
export function szrRewriteProofHolds<TCall extends { arguments: { length: number } }>(
    szrCalls: readonly TCall[],
    szrArgumentAnalyses: ReadonlyMap<TCall, SzrArgumentAnalysisOf<TCall>[]>,
    replacedCalls: ReadonlySet<unknown>,
    source: string,
    commentSpans: ReadonlyArray<{ start: number; end: number }>,
): boolean {
    let provenCalls = 0;
    for (const call of szrCalls) {
        const analyses = szrArgumentAnalyses.get(call) ?? [];
        if (call.arguments.length !== analyses.length) return false;
        const allSafe = analyses.every(analysis => szrArgumentProven(analysis, replacedCalls));
        if (!allSafe) return false;
        provenCalls += 1;
    }
    const occurrences = countSzrWordOccurrencesOutsideComments(source, commentSpans);
    return szrRewriteApproved(occurrences, provenCalls, false);
}
