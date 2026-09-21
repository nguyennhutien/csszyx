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
 * The rules a sample sets: its own signature's, or one unconditional rule.
 *
 * @param sample - One class and what it sets.
 * @returns Importance, and the properties set under each context.
 */
function rulesOf(sample: CandidateSignature): {
    important: boolean;
    rules: ReadonlyMap<string, readonly string[]>;
} {
    const signature = sample.signature;
    if (signature === undefined) {
        return { important: false, rules: new Map([['["&"]', sample.properties]]) };
    }
    return {
        important: signature.important,
        rules: new Map(signature.rules.map(rule => [rule.context, rule.properties])),
    };
}

/**
 * Whether the later class writes everything the earlier one wrote, under the
 * same selector and at-rule context and with the same importance.
 *
 * Context is part of the reference, not only of the build: a merger that let
 * `hover:p-8` replace `p-2` would drop a declaration that still applies, and a
 * reference that compared flat property sets would call that correct.
 *
 * @param earlier - The class that may be dropped.
 * @param later - The class that may replace it.
 * @param side - Maps a property to the side it lands on, or leaves it.
 * @returns True when the later class covers the earlier one.
 */
function coversInContext(
    earlier: CandidateSignature,
    later: CandidateSignature,
    side: (property: string) => string,
): boolean {
    const before = rulesOf(earlier);
    const after = rulesOf(later);
    if (before.important !== after.important) return false;
    for (const [context, properties] of before.rules) {
        const covering = after.rules.get(context);
        if (covering === undefined) return false;
        if (!isSubset(properties.map(side), new Set(covering.map(side)))) return false;
    }
    return true;
}

/** What the merger did to one ordered pair, against the reference. */
type PairOutcome = 'falseDelete' | 'writingModeOnlyDelete' | 'miss' | 'agree';

/**
 * Judge one ordered pair: what the registered merger did against what the
 * reference allows.
 *
 * @param previous - The earlier class.
 * @param later - The later class.
 * @returns How the merger's answer compares with the reference.
 */
function judgePair(previous: CandidateSignature, later: CandidateSignature): PairOutcome {
    const shouldDelete =
        coversInContext(previous, later, property => horizontalProperty(property, 'ltr')) &&
        coversInContext(previous, later, property => horizontalProperty(property, 'rtl'));
    const didDelete = szcn(previous.candidate, later.candidate) === later.candidate;
    if (didDelete && !shouldDelete) return 'falseDelete';
    if (!didDelete && shouldDelete) return 'miss';
    if (didDelete && !coversInContext(previous, later, property => property)) {
        return 'writingModeOnlyDelete';
    }
    return 'agree';
}

/**
 * Count what the registered merger does to every ordered pair.
 *
 * @param signatures - Served candidates and their emitted property sets.
 * @returns Deterministic ordered-pair counts.
 */
function countPairs(signatures: readonly CandidateSignature[]): MergeBaseline {
    const counts = { falseDelete: 0, writingModeOnlyDelete: 0, miss: 0, agree: 0 };
    const falseDeleteExamples: string[] = [];
    const missExamples: string[] = [];
    for (const previous of signatures) {
        for (const later of signatures) {
            const outcome = judgePair(previous, later);
            counts[outcome] += 1;
            const pair = `${previous.candidate} → ${later.candidate}`;
            if (outcome === 'falseDelete' && falseDeleteExamples.length < 8) {
                falseDeleteExamples.push(pair);
            }
            if (outcome === 'miss' && missExamples.length < 8) missExamples.push(pair);
        }
    }
    const falseDeletes = counts.falseDelete;
    const writingModeOnlyDeletes = counts.writingModeOnlyDelete;
    const misses = counts.miss;
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
