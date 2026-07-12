/**
 * Additional szv() branch coverage beyond szv-validation.test.ts: the
 * `base` / `defaultVariants` shape warnings (as opposed to `variants`),
 * the `describe()` helper's null/array cases, a mis-shaped config that
 * still has a usable `base` (fallback-with-base path), and a selection
 * made against a variant dimension that is declared but holds `undefined`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDevWarnCache } from '../src/dev-warn.js';
import { szv } from '../src/variants.js';

describe('szv config shape warnings (base / defaultVariants)', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        resetDevWarnCache();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    const warned = (re: RegExp) => warn.mock.calls.some(c => re.test(String(c[0])));

    it('warns when base is present but not an object (and describes null)', () => {
        // @ts-expect-error — intentionally invalid base
        szv({ base: null });
        expect(warned(/base must be an sz object, got null/)).toBe(true);
    });

    it('warns when base is an array (describe() array branch)', () => {
        // @ts-expect-error — intentionally invalid base
        szv({ base: [] });
        expect(warned(/base must be an sz object, got an array/)).toBe(true);
    });

    it('warns when defaultVariants is present but not an object', () => {
        // @ts-expect-error — intentionally invalid defaultVariants
        szv({ variants: { size: { sm: { px: 2 } } }, defaultVariants: 'sm' });
        expect(warned(/defaultVariants must be an object, got string/)).toBe(true);
    });

    it('still uses a valid base when a different part of the config is broken', () => {
        // variants is mis-shaped (falls back / returns false from validation),
        // but base is a legitimate sz object and must still be used.
        const f = szv({
            base: { p: 4 },
            // @ts-expect-error — intentionally invalid variants
            variants: 'nope',
        });
        expect(f()).toEqual({ p: 4 });
        expect(warned(/variants must be an object/)).toBe(true);
    });
});

describe('szv selection validation against an undeclared/undefined variants map', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        resetDevWarnCache();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    const warned = (re: RegExp) => warn.mock.calls.some(c => re.test(String(c[0])));

    it('warns "unknown variant" when the config declares no variants at all', () => {
        const f = szv({ base: { p: 4 } });
        // @ts-expect-error — no variants declared on this config
        expect(f({ color: 'blue' })).toEqual({ p: 4 });
        expect(warned(/unknown variant "color"/)).toBe(true);
    });

    it('warns "not a value of variant" when the dimension is declared but undefined', () => {
        const f = szv({
            // @ts-expect-error — a declared-but-undefined dimension
            variants: { size: undefined },
        });
        // @ts-expect-error — selecting a token for it
        expect(f({ size: 'sm' })).toEqual({});
        expect(warned(/"sm" is not a value of variant "size"/)).toBe(true);
    });
});
