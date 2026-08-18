/**
 * Membership gate for BOOLEAN_ONLY_DYNAMIC_KEYS — the keys whose dynamic
 * values must lower to a conditional bare class instead of the css-var
 * strategy. Each member must satisfy all three criteria:
 *
 *   (a) the sz type vocabulary accepts a boolean (locked at the declaration
 *       site: the set is derived from a `satisfies SzProps` literal whose
 *       values are all `true`, so tsc rejects a non-boolean member),
 *   (b) `true` lowers to the bare class on every engine artifact,
 *   (c) the css-var valued form would be WRONG: the utility prefix is owned
 *       by a color twin, is a logical border side (Tailwind resolves
 *       `border-*-(--var)` to border-color on every side), or the key has no
 *       valued form at all.
 *
 * Membership drift in either direction fails here before it ships.
 */
import { describe, expect, it } from 'vitest';

import { BOOLEAN_ONLY_DYNAMIC_KEYS, PROPERTY_MAP } from '../src/transform-core.js';
import { expectParity } from './engine-parity-harness';

/** Bare class each member must emit for `true` — criterion (b) expectations. */
const MEMBER_BARE_CLASS: Record<string, string> = {
    border: 'border',
    borderT: 'border-t',
    borderR: 'border-r',
    borderB: 'border-b',
    borderL: 'border-l',
    borderX: 'border-x',
    borderY: 'border-y',
    borderS: 'border-s',
    borderE: 'border-e',
    borderBs: 'border-bs',
    borderBe: 'border-be',
    ring: 'ring',
    outline: 'outline',
    truncate: 'truncate',
    shadow: 'shadow',
};

describe('BOOLEAN_ONLY_DYNAMIC_KEYS membership gate', () => {
    it('matches the expected bare-class table', () => {
        expect([...BOOLEAN_ONLY_DYNAMIC_KEYS].sort()).toEqual(
            Object.keys(MEMBER_BARE_CLASS).sort(),
        );
    });

    it('lowers `true` to the bare class on every engine — criterion (b)', () => {
        for (const [key, bareClass] of Object.entries(MEMBER_BARE_CLASS)) {
            expectParity(`{ ${key}: true }`, bareClass);
        }
    });

    it('is css-var-hostile for every member — criterion (c)', () => {
        for (const key of BOOLEAN_ONLY_DYNAMIC_KEYS) {
            const prefix = PROPERTY_MAP[key];
            // No valued form exists at all (truncate).
            const noValuedForm = prefix === undefined;
            // Another key owns the same prefix as its COLOR form, so the
            // paren-var utility resolves to a color, not this key's property.
            const colorTwin =
                prefix !== undefined &&
                Object.entries(PROPERTY_MAP).some(
                    ([twin, twinPrefix]) =>
                        twin !== key && twinPrefix === prefix && /color/i.test(twin),
                );
            // Logical border sides have no csszyx color-twin KEY, but Tailwind
            // still resolves `border-<side>-(--var)` to the side's color.
            const logicalBorderSide = prefix !== undefined && /^border-(?:s|e|bs|be)$/.test(prefix);
            expect(
                noValuedForm || colorTwin || logicalBorderSide,
                `"${key}" has a valid css-var valued form — it does not belong in BOOLEAN_ONLY_DYNAMIC_KEYS`,
            ).toBe(true);
        }
    });

    it('excludes value-typed keys and the divide siblings', () => {
        // divideX/divideY are deliberate non-members: their failure shape is
        // unverified in the field, and the reporter asked us not to widen.
        for (const nonMember of ['divideX', 'divideY', 'w', 'p', 'z', 'bg', 'borderColor']) {
            expect(BOOLEAN_ONLY_DYNAMIC_KEYS.has(nonMember), nonMember).toBe(false);
        }
    });
});
