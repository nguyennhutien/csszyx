import { afterEach, describe, expect, it, vi } from 'vitest';
import { type SzObject, transform } from '../src/transform.js';

/**
 * Alignment sz-keys take csszyx's short value form (start/end/between/around/
 * evenly), not the CSS-spec longhand (flex-start/space-between/...). A longhand
 * value lowers to a DEAD class (`self-flex-start` has no Tailwind utility), so a
 * dev-only warning names the short form. These lock that contract.
 *
 * Note: the warning de-dups per (key, value) at module scope, so each signature
 * is exercised in exactly one test (and the dedup test uses its own signature).
 */
describe('alignment CSS-longhand value warning (dev)', () => {
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
        return calls.filter(c => c.includes('is a CSS value'));
    };

    it('warns on self: flex-start and names the short form', () => {
        const w = warns({ self: 'flex-start' } as SzObject);
        expect(w).toHaveLength(1);
        expect(w[0]).toContain("self: 'flex-start'");
        expect(w[0]).toContain("'start'");
        expect(w[0]).toContain('no Tailwind utility');
    });

    it('warns on justify: flex-end', () => {
        expect(warns({ justify: 'flex-end' } as SzObject)[0]).toContain("'end'");
    });

    it('warns on items: flex-start', () => {
        expect(warns({ items: 'flex-start' } as SzObject)).toHaveLength(1);
    });

    it('warns on alignContent: space-around', () => {
        expect(warns({ alignContent: 'space-around' } as SzObject)[0]).toContain("'around'");
    });

    it('does NOT warn on the valid short value', () => {
        expect(warns({ justify: 'between' } as SzObject)).toEqual([]);
        expect(warns({ self: 'center' } as SzObject)).toEqual([]);
    });

    it('does NOT warn on the pseudo-element `content` key (arbitrary string is valid)', () => {
        // content is CSS content (pseudo), not alignment — excluded from the hint.
        expect(warns({ content: 'space-evenly' } as SzObject)).toEqual([]);
    });

    it('does NOT warn on a non-alignment key that happens to take such a value', () => {
        expect(warns({ bg: 'space-between' } as SzObject)).toEqual([]);
    });

    it('de-dups: the same key+value warns only once across renders', () => {
        // Unique signature so prior tests don't consume the dedup slot.
        const calls: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((m: string) => {
            if (String(m).includes('is a CSS value')) calls.push(m);
        });
        transform({ placeItems: 'space-between' } as SzObject);
        transform({ placeItems: 'space-between' } as SzObject);
        spy.mockRestore();
        expect(calls).toHaveLength(1);
    });
});
