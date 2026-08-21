/**
 * The adapter that reads a project's own Tailwind for the theme-collision rule.
 *
 * What the rule needs is derived, not listed: which class roots a namespace
 * feeds is found by injecting a probe token and seeing which roots come back
 * carrying it, and which names are ambiguous is Tailwind's own answer to
 * reading one name two ways. Both derivations run over `getClassList()`, whose
 * declared shape is a union — a bare class name, or a name paired with its
 * modifiers — so the adapter has to read either without changing its answer.
 *
 * Driven by a stand-in design system rather than a compiled stylesheet: the
 * compile is covered where the oracle is built, and pinning the arithmetic on a
 * real one would make the test depend on how many roots the pinned Tailwind
 * happens to feed.
 */
import { describe, expect, it } from 'vitest';

import {
    type CollisionDesignSystem,
    collisionOracleFrom,
    PROBE_TOKENS,
} from '../src/scanner/collision-oracle.js';

/** One way Tailwind reads a candidate class name. */
type Reading = { kind: string; root: string; value?: { kind: string; value: string } | null };

/** Readings the stand-in returns, keyed by the candidate asked about. */
const READINGS: Record<string, Reading[]> = {
    [`text-${PROBE_TOKENS.colors}`]: [
        { kind: 'functional', root: 'text', value: { kind: 'named', value: PROBE_TOKENS.colors } },
    ],
    [`bg-${PROBE_TOKENS.colors}`]: [
        { kind: 'functional', root: 'bg', value: { kind: 'named', value: PROBE_TOKENS.colors } },
    ],
    // Read BOTH ways: a whole static utility, and a root plus a value.
    'text-balance': [
        { kind: 'static', root: 'text-balance' },
        { kind: 'functional', root: 'text', value: { kind: 'named', value: 'balance' } },
    ],
    // Functional only — an ordinary token slot, not a collision.
    'bg-red-500': [{ kind: 'functional', root: 'bg', value: { kind: 'named', value: 'red-500' } }],
};

/**
 * A design system whose class list yields BARE names, the other half of the
 * shape Tailwind declares for `getClassList`.
 *
 * @returns The stand-in.
 */
function bareNameDesign(): CollisionDesignSystem {
    return {
        getClassList: () => Object.keys(READINGS),
        parseCandidate: candidate => READINGS[candidate] ?? [],
    };
}

describe('collisionOracleFrom', () => {
    it('reads a class list of bare names, not only of name-and-modifier pairs', () => {
        // Taking the first element of a bare name yields its first CHARACTER,
        // which parses as nothing and empties the oracle without failing.
        const oracle = collisionOracleFrom(bareNameDesign());

        expect(oracle.prefixesFor('colors')).toEqual(new Set(['text', 'bg']));
    });

    it('reports no prefixes for a namespace whose probe nothing carried', () => {
        // A namespace the project's Tailwind feeds no root at all. The rule
        // iterates what comes back, so an empty set is the answer it needs;
        // undefined would be a crash at the call site.
        const oracle = collisionOracleFrom(bareNameDesign());

        expect(oracle.prefixesFor('fontWeights')).toEqual(new Set());
    });

    it('calls a name ambiguous only when it is read both ways', () => {
        const oracle = collisionOracleFrom(bareNameDesign());

        expect(oracle.ambiguousNames('text')).toEqual(new Set(['balance']));
    });

    it('leaves a functional-only reading out, since it is an ordinary token slot', () => {
        const oracle = collisionOracleFrom(bareNameDesign());

        expect(oracle.ambiguousNames('bg')).toEqual(new Set());
    });
});
