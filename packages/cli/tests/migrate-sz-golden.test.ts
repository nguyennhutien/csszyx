/**
 * Golden of the sz object `migrate` writes for every Tailwind prefix the
 * compiler can emit.
 *
 * The existing round-trip suite (corpus-roundtrip.test.ts) checks
 * `class -> classNameToSzObject() -> transform() === class`, which is blind to
 * a wrong sz key by construction: `rotate-x-45` read as `rotate: 'x-45'` still
 * lowers back to `rotate-x-45`. The wrongness is only visible in the
 * intermediate sz object, which is what this golden records.
 *
 * It is exhaustive over the prefixes rather than sampled from the pinned
 * corpora, because the corpora do not contain the classes that went wrong:
 * `grep 'rotate-x\|border-bs' scripts/corpus/*.txt` returns nothing, so a
 * sampled golden would have stayed silent on exactly the bug this exists for.
 *
 * Cases live in generated/migrate-sz-golden.json — run `pnpm gen:migrate-golden`
 * to refresh, and `pnpm gen:migrate-golden:check` fails CI when it is stale.
 */

import { PROPERTY_MAP } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import { REVERSE_PROPERTY_MAP } from '../src/migrate/generated/reverse-property-map.js';
import { classNameToSzObject } from '../src/migrate/variant-parser.js';
import golden from './generated/migrate-sz-golden.json' with { type: 'json' };

interface GoldenCase {
    class: string;
    sz: Record<string, unknown>;
    unrecognized?: string[];
    keepInClassName?: string[];
}

const prefixes = golden.prefixes as unknown as Record<string, GoldenCase[]>;
const allCases = Object.values(prefixes).flat();

describe('migrate sz golden', () => {
    it('has cases to run', () => {
        expect(allCases.length).toBeGreaterThan(0);
    });

    it('covers every prefix the compiler can emit', () => {
        const missing = [...new Set(Object.values(PROPERTY_MAP))]
            .filter(prefix => !(prefix in prefixes))
            .sort();

        expect(missing).toEqual([]);
    });

    it('covers every prefix migrate can read back', () => {
        const missing = Object.keys(REVERSE_PROPERTY_MAP)
            .filter(prefix => !(prefix in prefixes))
            .sort();

        expect(missing).toEqual([]);
    });

    it.each(allCases)('$class', ({ class: cls, sz, unrecognized, keepInClassName }) => {
        const actual = classNameToSzObject(cls);

        expect(actual.szObject).toEqual(sz);
        expect(actual.unrecognized).toEqual(unrecognized ?? []);
        expect(actual.keepInClassName).toEqual(keepInClassName ?? []);
    });
});
