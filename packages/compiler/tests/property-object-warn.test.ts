import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    SPECIAL_VARIANTS,
    type SzObject,
    transform,
} from '../src/transform-core.js';

/**
 * A PROPERTY key that receives an object (other than the documented
 * `{ color, op }` form) falls through to variant handling and emits classes
 * like `p:bg-red-500` — `p:` matches no Tailwind variant, so the styles
 * silently generate no CSS. The dev warning is the only surface that makes
 * that visible; these lock its trigger contract.
 *
 * Note: the warning de-dups per key at module scope, so each key is
 * exercised in exactly one test.
 */
describe('property-key object-value warning (dev)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const warns = (sz: SzObject): string[] => {
        const calls: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((m: string) => {
            calls.push(m);
        });
        transform(sz);
        spy.mockRestore();
        return calls.filter(c => c.includes('is a property, not a variant'));
    };

    it('warns on a property key holding a nested object and echoes its keys', () => {
        const w = warns({ p: { bg: 'red-500' } } as SzObject);
        expect(w).toHaveLength(1);
        expect(w[0]).toContain('"p" is a property, not a variant');
        expect(w[0]).toContain('{ bg }');
        expect(w[0]).toContain('"p:*" classes');
        expect(w[0]).toContain('generate no CSS');
    });

    it('warns on a malformed color-opacity object missing the color key', () => {
        const w = warns({ shadow: { op: 12.5 } } as SzObject);
        expect(w).toHaveLength(1);
        expect(w[0]).toContain('"shadow"');
        expect(w[0]).toContain("{ color: '...', op: ... }");
    });

    it('warns inside variant nesting', () => {
        expect(warns({ hover: { m: { p: 2 } } } as SzObject)[0]).toContain('"m"');
    });

    it('stays silent for every documented object shape', () => {
        expect(warns({ hover: { bg: 'blue-500' } } as SzObject)).toHaveLength(0);
        expect(warns({ bg: { color: 'blue-500', op: 50 } } as SzObject)).toHaveLength(0);
        expect(warns({ css: { writingMode: 'vertical-lr' } } as SzObject)).toHaveLength(0);
        expect(warns({ bgImg: { gradient: 'linear', dir: 45 } } as SzObject)).toHaveLength(0);
        expect(warns({ data: { active: { bg: 'blue-500' } } } as SzObject)).toHaveLength(0);
        expect(warns({ group: { hover: { color: 'white' } } } as SzObject)).toHaveLength(0);
        expect(warns({ md: { p: 4 } } as SzObject)).toHaveLength(0);
    });

    it('de-dups repeated keys', () => {
        expect(warns({ gap: { m: 2 } } as SzObject)).toHaveLength(1);
        expect(warns({ gap: { p: 2 } } as SzObject)).toHaveLength(0);
    });

    it('property keys and variant names are disjoint (guard precondition)', () => {
        // The warning assumes a key cannot be both a property and a variant;
        // if a future key lands in both sets, this fails before users see a
        // false positive.
        const overlap = Object.keys(PROPERTY_MAP).filter(
            key => KNOWN_VARIANTS.has(key) || SPECIAL_VARIANTS.has(key),
        );
        expect(overlap).toEqual([]);
    });
});
