/**
 * A numeric font weight written as a string.
 *
 * Tailwind v4 spells weights through `--font-weight-*`, so a bare
 * `font-700` is not a utility and generates no CSS. `{ weight: 700 }` — the
 * number — is bracketed for exactly that reason. The string form went
 * through the generic path instead and emitted the bare class, styling
 * nothing and saying nothing.
 *
 * The class is still emitted, as it is for a dead spacing step: csszyx says
 * what Tailwind will do with it rather than guessing what the author meant.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SzObject, transform } from '../src/transform-core.js';

describe('dead font-weight value warning', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    const warns = (sz: SzObject): string[] => {
        const calls: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((m: string) => {
            calls.push(m);
        });
        transform(sz);
        spy.mockRestore();
        return calls.filter(c => c.includes('font weight'));
    };

    it('warns that a numeric string weight generates no CSS, and says what to write', () => {
        const w = warns({ weight: '700' } as SzObject);
        expect(w).toHaveLength(1);
        expect(w[0]).toContain(`"weight: '700'"`);
        expect(w[0]).toContain('generates no CSS');
        expect(w[0]).toContain('"font-700"');
        expect(w[0]).toContain('weight: 700');
    });

    it('still emits the class it warned about, rather than guessing', () => {
        expect(transform({ weight: '700' } as SzObject).className).toBe('font-700');
    });

    it('warns for every numeric spelling, since none of them is a utility', () => {
        for (const value of ['100', '550', '0', '2', '1.5', '900']) {
            expect(warns({ weight: value } as SzObject), value).toHaveLength(1);
        }
    });

    it('stays quiet for the spellings Tailwind does serve', () => {
        for (const value of ['bold', 'thin', '--w', '[700]', '700deg']) {
            expect(warns({ weight: value } as SzObject), value).toEqual([]);
        }
        expect(warns({ weight: 700 } as SzObject)).toEqual([]);
    });

    it('stays quiet for a numeric string on any other key', () => {
        expect(warns({ text: '700' } as SzObject)).toEqual([]);
        expect(warns({ z: '700' } as SzObject)).toEqual([]);
    });
});
