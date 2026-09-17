import { szcn } from '../../runtime/src/merge-classes.js';
import {
    __resetMergeSignaturesForTests,
    registerMergeSignatures,
} from '../../runtime/src/merge-signatures.js';
import {
    createMergeSignatureTable,
    horizontalProperty,
    type MergeSignature,
    mergeSignatureFromCss,
} from '../src/merge-signature.js';
/** One class and the leaf CSS properties Tailwind emits for it. */
export interface CandidateSignature {
    candidate: string;
    properties: readonly string[];
    /**
     * What the build reads from the compiled CSS. A hand-written sample leaves
     * it out and is treated as one unconditional rule.
     */
    signature?: MergeSignature;
}

/** Deterministic measurements from one ordered-pair corpus. */
export interface MergeBaseline {
    candidates: number;
    orderedPairs: number;
    falseDeletes: number;
    writingModeOnlyDeletes: number;
    misses: number;
    falseDeleteExamples: readonly string[];
    missExamples: readonly string[];
}

/**
 * Derive the property-set half of a merge signature from Tailwind CSS.
 *
 * Candidate declarations live under selector rules. Global `@property` and
 * keyframe declarations are supporting definitions, not writes performed by
 * applying the class, so they do not enter the signature.
 *
 * @param candidate - Candidate that produced the CSS.
 * @param css - CSS returned for that candidate.
 * @returns Deterministic signature, or null when the candidate emits no CSS.
 */
export function signatureFromCss(candidate: string, css: string | null): CandidateSignature | null {
    const signature = mergeSignatureFromCss(candidate, css);
    if (signature === null) return null;
    const properties = new Set(signature.rules.flatMap(rule => rule.properties));
    return { candidate, properties: [...properties].sort(), signature };
}

/**
 * Whether every property on the left is also written by the right.
 *
 * @param left - Properties that must be covered.
 * @param right - Properties available to cover them.
 * @returns True when left is a subset of right.
 */
function isSubset(left: readonly string[], right: ReadonlySet<string>): boolean {
    return left.every(property => right.has(property));
}

/**
 * Compare sets after resolving logical properties in horizontal writing mode.
 *
 * @param left - Properties that must be covered.
 * @param right - Properties available to cover them.
 * @param direction - Inline text direction.
 * @returns True when right covers left after logical-property resolution.
 */
function isHorizontalSubset(
    left: readonly string[],
    right: readonly string[],
    direction: 'ltr' | 'rtl',
): boolean {
    return isSubset(
        left.map(property => horizontalProperty(property, direction)),
        new Set(right.map(property => horizontalProperty(property, direction))),
    );
}

/**
 * Hold the runtime merger, fed the table a build would generate for these
 * classes, against the reference rule: a later class may replace an earlier one
 * only if it sets every property the earlier one set, left to right and right
 * to left.
 *
 * The reference compares flat property sets; the build also keeps selector
 * context and importance apart, so it may keep a class the reference would let
 * go (a miss, harmless) but must never drop one the reference keeps (a false
 * delete). O(n²) szcn calls for n classes.
 *
 * @param signatures - Served candidates and their emitted property sets.
 * @returns Deterministic ordered-pair counts.
 */
export function measureMergeSafety(signatures: readonly CandidateSignature[]): MergeBaseline {
    const built = new Map(
        signatures.map(({ candidate, properties, signature }) => [
            candidate,
            signature ?? { important: false, rules: [{ context: '["&"]', properties }] },
        ]),
    );
    registerMergeSignatures(
        createMergeSignatureTable([...built.keys()], candidate => built.get(candidate) ?? null),
    );
    try {
        return countPairs(signatures);
    } finally {
        __resetMergeSignaturesForTests();
    }
}

/**
 * Count what the registered merger does to every ordered pair.
 *
 * @param signatures - Served candidates and their emitted property sets.
 * @returns Deterministic ordered-pair counts.
 */
function countPairs(signatures: readonly CandidateSignature[]): MergeBaseline {
    let falseDeletes = 0;
    let writingModeOnlyDeletes = 0;
    let misses = 0;
    const falseDeleteExamples: string[] = [];
    const missExamples: string[] = [];
    for (const previous of signatures) {
        for (const later of signatures) {
            const rawSubset = isSubset(previous.properties, new Set(later.properties));
            const ltrSubset = isHorizontalSubset(previous.properties, later.properties, 'ltr');
            const rtlSubset = isHorizontalSubset(previous.properties, later.properties, 'rtl');
            const shouldDelete = ltrSubset && rtlSubset;
            const didDelete = szcn(previous.candidate, later.candidate) === later.candidate;
            if (didDelete && !shouldDelete) {
                falseDeletes += 1;
                if (falseDeleteExamples.length < 8) {
                    falseDeleteExamples.push(`${previous.candidate} → ${later.candidate}`);
                }
            }
            if (didDelete && !rawSubset && shouldDelete) writingModeOnlyDeletes += 1;
            if (!didDelete && shouldDelete) {
                misses += 1;
                if (missExamples.length < 8) {
                    missExamples.push(`${previous.candidate} → ${later.candidate}`);
                }
            }
        }
    }
    return {
        candidates: signatures.length,
        orderedPairs: signatures.length ** 2,
        falseDeletes,
        writingModeOnlyDeletes,
        misses,
        falseDeleteExamples,
        missExamples,
    };
}
