import { szcn } from '../../runtime/src/merge-classes.js';
import { mergeSignatureFromCss } from '../src/merge-signature.js';

/** One class and the leaf CSS properties Tailwind emits for it. */
export interface CandidateSignature {
    candidate: string;
    properties: readonly string[];
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
    return { candidate, properties: [...properties].sort() };
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
 * Map logical properties to horizontal-writing-mode physical properties.
 *
 * @param property - Leaf CSS property.
 * @param direction - Inline text direction.
 * @returns Equivalent physical property for horizontal writing mode.
 */
function horizontalProperty(property: string, direction: 'ltr' | 'rtl'): string {
    const inlineStart = direction === 'ltr' ? 'left' : 'right';
    const inlineEnd = direction === 'ltr' ? 'right' : 'left';
    const corner = /^border-(start|end)-(start|end)-radius$/u.exec(property);
    if (corner !== null) {
        const block = corner[1] === 'start' ? 'top' : 'bottom';
        const inline = corner[2] === 'start' ? inlineStart : inlineEnd;
        return `border-${block}-${inline}-radius`;
    }
    if (property === 'inset-block-start') return 'top';
    if (property === 'inset-block-end') return 'bottom';
    if (property === 'inset-inline-start') return inlineStart;
    if (property === 'inset-inline-end') return inlineEnd;
    return property
        .replace('inline-size', 'width')
        .replace('block-size', 'height')
        .replace('block-start', 'top')
        .replace('block-end', 'bottom')
        .replace('inline-start', inlineStart)
        .replace('inline-end', inlineEnd);
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
 * Compare the current runtime merger with full property-set subset semantics.
 *
 * @param signatures - Served candidates and their emitted property sets.
 * @returns Deterministic ordered-pair counts.
 */
export function measureMergeBaseline(signatures: readonly CandidateSignature[]): MergeBaseline {
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
