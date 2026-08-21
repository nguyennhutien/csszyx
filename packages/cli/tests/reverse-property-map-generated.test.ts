/**
 * The migrate reverse map is an inversion of the compiler's PROPERTY_MAP, and
 * is generated so it cannot drift from it.
 *
 * It was written out by hand, and it drifted: `rotate-x` and `border-bs` were
 * missing, so `rotate-x-45` migrated to `rotate: 'x-45'` and `border-bs-2` to
 * `borderColor: 'bs-2'` — a colour key holding a border width. Neither was
 * caught, because both still lower back to exactly the class they came from.
 * Round-tripping cannot find this class of bug; only comparing against the
 * forward table can.
 *
 * What stays hand-written is the part that is a decision rather than a
 * derivation: when several sz keys lower to one prefix, which one migrate
 * writes by default.
 */

import { PROPERTY_MAP } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import { REVERSE_PROPERTY_MAP } from '../src/migrate/generated/reverse-property-map.js';
import {
    AMBIGUOUS_PREFIX_CHOICE,
    EXTRA_REVERSE_PREFIXES,
    SPECIAL_LOWERING_PREFIXES,
} from '../src/migrate/prefix-choice.js';

/**
 * Every sz key the compiler lowers to a given prefix.
 *
 * @param prefix - The Tailwind class prefix to look up.
 * @returns The sz keys PROPERTY_MAP lowers to it, empty when none do.
 */
function candidatesFor(prefix: string): string[] {
    return Object.entries(PROPERTY_MAP)
        .filter(([, value]) => value === prefix)
        .map(([key]) => key);
}

describe('REVERSE_PROPERTY_MAP is derived from PROPERTY_MAP', () => {
    it('covers every prefix the compiler can emit', () => {
        const missing = [...new Set(Object.values(PROPERTY_MAP))]
            .filter(prefix => !(prefix in SPECIAL_LOWERING_PREFIXES))
            .filter(prefix => !(prefix in REVERSE_PROPERTY_MAP));

        expect(missing).toEqual([]);
    });

    it('excludes only prefixes the compiler still emits', () => {
        // An exclusion for a prefix that no longer exists is a claim nobody is
        // checking any more, and it would hide a later regression.
        const dead = Object.keys(SPECIAL_LOWERING_PREFIXES).filter(
            prefix => candidatesFor(prefix).length === 0,
        );

        expect(dead).toEqual([]);
    });

    it('keeps every excluded prefix out of the generated map', () => {
        const leaked = Object.keys(SPECIAL_LOWERING_PREFIXES).filter(
            prefix => prefix in REVERSE_PROPERTY_MAP,
        );

        expect(leaked).toEqual([]);
    });

    it('maps each prefix to an sz key that really lowers to it', () => {
        const wrong = Object.entries(REVERSE_PROPERTY_MAP)
            .filter(([prefix]) => !(prefix in EXTRA_REVERSE_PREFIXES))
            .filter(([prefix, szKey]) => !candidatesFor(prefix).includes(szKey))
            .map(([prefix, szKey]) => `${prefix} -> ${szKey}`);

        expect(wrong).toEqual([]);
    });

    it('records a choice for every prefix more than one sz key lowers to', () => {
        const shared = [...new Set(Object.values(PROPERTY_MAP))].filter(
            prefix => candidatesFor(prefix).length > 1,
        );
        const undecided = shared.filter(prefix => !(prefix in AMBIGUOUS_PREFIX_CHOICE));

        expect(undecided).toEqual([]);
    });

    it('carries no choice for a prefix that is no longer shared', () => {
        const dead = Object.keys(AMBIGUOUS_PREFIX_CHOICE).filter(
            prefix => candidatesFor(prefix).length <= 1,
        );

        expect(dead).toEqual([]);
    });

    it('keeps the extras to prefixes the inversion cannot reach', () => {
        const redundant = Object.keys(EXTRA_REVERSE_PREFIXES).filter(
            prefix => candidatesFor(prefix).length > 0,
        );

        expect(redundant).toEqual([]);
    });
});
