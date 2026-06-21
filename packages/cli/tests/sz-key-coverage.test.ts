/**
 * Behavioral coverage gate (stronger than the presence-only
 * property-map-coverage test): every compiler sz key — PROPERTY_MAP ∪
 * BOOLEAN_SHORTHANDS — must have at least one snippet-derived forward/reverse
 * case in sz-key-cases.json, or be listed in `exempt` with a reason.
 *
 * `exempt` is for keys with no concrete single-class snippet representation:
 * directional/logical aliases that round-trip through a sibling key (e.g.
 * borderBColor via borderB, liningNums via fontVariant) and niche keys with no
 * standalone documented class. Regenerate with `pnpm gen:key-tests`; a newly
 * uncovered key shows up as an exempt-list diff for review.
 */
import { describe, expect, it } from 'vitest';

import { BOOLEAN_SHORTHANDS, PROPERTY_MAP } from '../../compiler/src/transform-core.js';
import cases from './generated/sz-key-cases.json' with { type: 'json' };

const covered = new Set(Object.keys(cases.keys));
const exempt = new Set(Object.keys(cases.exempt));
const allKeys = [...new Set([...Object.keys(PROPERTY_MAP), ...BOOLEAN_SHORTHANDS])].sort();

describe('sz key coverage gate', () => {
    it('every compiler key is covered or exempt', () => {
        const missing = allKeys.filter(k => !covered.has(k) && !exempt.has(k));
        expect(missing).toEqual([]);
    });

    it('no exempt key is also covered (stale exemption)', () => {
        const redundant = [...exempt].filter(k => covered.has(k));
        expect(redundant).toEqual([]);
    });

    it('every exempt key carries a reason', () => {
        const reasons = cases.exempt as Record<string, string>;
        const empty = Object.keys(reasons).filter(k => !reasons[k]);
        expect(empty).toEqual([]);
    });

    it('every covered key has at least one case', () => {
        const empty = Object.entries(
            cases.keys as Record<string, { forward: unknown[]; reverse: unknown[] }>,
        )
            .filter(([, v]) => v.forward.length === 0 && v.reverse.length === 0)
            .map(([k]) => k);
        expect(empty).toEqual([]);
    });
});
