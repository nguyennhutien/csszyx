import { PROPERTY_MAP } from '../packages/compiler/src/transform-core.js';

/** Candidate sz entry for one Tailwind utility. */
export interface SzCandidate {
    /** Candidate sz property. */
    szKey: string;
    /** Candidate static value. */
    value: string | number | boolean;
}

const prefixToKeys = new Map<string, string[]>();
for (const [szKey, tailwindPrefix] of Object.entries(PROPERTY_MAP)) {
    const keys = prefixToKeys.get(tailwindPrefix) ?? [];
    keys.push(szKey);
    prefixToKeys.set(tailwindPrefix, keys);
}
const sortedPrefixes = [...prefixToKeys.keys()].sort((a, b) => b.length - a.length);

/**
 * Convert a Tailwind suffix to its nearest sz scalar representation.
 * @param rawValue - Tailwind utility suffix.
 * @returns Numeric value when lossless, otherwise the original string.
 */
function parseCandidateValue(rawValue: string): string | number {
    const numeric = Number(rawValue);
    return !Number.isNaN(numeric) && rawValue !== '' ? numeric : rawValue;
}

/**
 * Append every sz key mapped to a Tailwind prefix.
 * @param candidates - Destination candidate list.
 * @param prefix - Matched Tailwind prefix.
 * @param value - Candidate sz value.
 */
function appendPrefixCandidates(
    candidates: SzCandidate[],
    prefix: string,
    value: SzCandidate['value'],
): void {
    for (const szKey of prefixToKeys.get(prefix) ?? []) {
        candidates.push({ szKey, value });
    }
}

/**
 * Parse a bare Tailwind class through the inverted compiler property map.
 * @param twClass - Tailwind class without a variant prefix.
 * @returns Candidate sz entries ordered by the compiler's longest prefix.
 */
export function classToSzCandidates(twClass: string): SzCandidate[] {
    const candidates: SzCandidate[] = [];
    for (const prefix of sortedPrefixes) {
        if (twClass === prefix) {
            appendPrefixCandidates(candidates, prefix, true);
            break;
        }

        const separator = `${prefix}-`;
        if (!twClass.startsWith(separator)) continue;
        appendPrefixCandidates(
            candidates,
            prefix,
            parseCandidateValue(twClass.slice(separator.length)),
        );
        break;
    }
    return candidates;
}
