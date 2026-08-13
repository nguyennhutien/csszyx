import { afterEach, describe, expect, it, vi } from 'vitest';
import { type SzObject, setSzWarnLocation, transform } from '../src/transform-core.js';

/**
 * Tailwind's bare spacing syntax only accepts quarter steps (multiples of
 * 0.25) — `p-1.4` generates no CSS — and a unitless bracket is no escape
 * (`padding: 1.4` is invalid CSS). The dev warning is the only surface that
 * makes the silently-dropped class visible; these lock its trigger contract.
 *
 * Note: the warning de-dups per (key, value) at module scope, so each
 * signature is exercised in exactly one test.
 */
describe('dead spacing-step warning (dev)', () => {
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
        return calls.filter(c => c.includes('spacing scale'));
    };

    it('warns on a non-quarter-step padding number and suggests fixes', () => {
        const w = warns({ p: 1.4 } as SzObject);
        expect(w).toHaveLength(1);
        expect(w[0]).toContain('"p: 1.4"');
        expect(w[0]).toContain('generates no CSS');
        expect(w[0]).toContain('"1.4rem"');
    });

    it('warns on a numeric-string spacing value', () => {
        expect(warns({ m: '2.3' } as SzObject)[0]).toContain('"m: 2.3"');
    });

    it('warns under a variant', () => {
        expect(warns({ hover: { gap: 3.1 } } as SzObject)[0]).toContain('"gap: 3.1"');
    });

    it('stays silent for quarter steps, units, and non-spacing keys', () => {
        expect(warns({ p: 1.5 } as SzObject)).toHaveLength(0);
        expect(warns({ m: 0.75 } as SzObject)).toHaveLength(0);
        expect(warns({ w: '1.4rem' } as SzObject)).toHaveLength(0);
        // leading falls back to the unitless-ratio bracket instead.
        expect(warns({ leading: 1.4 } as SzObject)).toHaveLength(0);
        // opacity is not a spacing-scale utility.
        expect(warns({ opacity: 33.3 } as SzObject)).toHaveLength(0);
    });

    it('appends the source location when the build engine has set one', () => {
        setSzWarnLocation('src/App.tsx:12');
        try {
            expect(warns({ px: 2.2 } as SzObject)[0]).toContain(' at src/App.tsx:12');
        } finally {
            setSzWarnLocation(undefined);
        }
    });

    it('de-dups repeated signatures', () => {
        expect(warns({ pt: 1.9 } as SzObject)).toHaveLength(1);
        expect(warns({ pt: 1.9 } as SzObject)).toHaveLength(0);
    });
});
