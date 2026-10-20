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
import { configInvalidLine, unknownValueLine, unknownVariantLine } from './helpers/szv-lines.js';

describe('szv config shape warnings (base / defaultVariants)', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        resetDevWarnCache();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('warns when base is present but not an object (and describes null)', () => {
        // @ts-expect-error — intentionally invalid base
        szv({ base: null });
        expect(warn.mock.calls).toEqual([[configInvalidLine('base', 'null')]]);
    });

    it('warns when base is an array (describe() array branch)', () => {
        // @ts-expect-error — intentionally invalid base
        szv({ base: [] });
        expect(warn.mock.calls).toEqual([[configInvalidLine('base', 'an array')]]);
    });

    it('ignores a base that is not an sz object, as its line says', () => {
        // A string spread into an object gives index keys (`{ 0: 'p', … }`),
        // which would lower to classes nobody wrote.
        const f = szv({
            // @ts-expect-error — intentionally invalid base
            base: 'p-4',
            variants: { size: { sm: { px: 2 } } },
        });
        expect(f()).toEqual({});
        expect(f({ size: 'sm' })).toEqual({ px: 2 });
        expect(warn.mock.calls).toEqual([[configInvalidLine('base', 'string')]]);
    });

    it('warns when defaultVariants is present but not an object', () => {
        // @ts-expect-error — intentionally invalid defaultVariants
        szv({ variants: { size: { sm: { px: 2 } } }, defaultVariants: 'sm' });
        expect(warn.mock.calls).toEqual([[configInvalidLine('default-variants', 'string')]]);
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
        expect(warn.mock.calls).toEqual([[configInvalidLine('variants', 'string')]]);
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

    it('warns "unknown variant" when the config declares no variants at all', () => {
        const f = szv({ base: { p: 4 } });
        // @ts-expect-error — no variants declared on this config
        expect(f({ color: 'blue' })).toEqual({ p: 4 });
        expect(warn.mock.calls).toEqual([[unknownVariantLine('color')]]);
    });

    it('warns "not a value of variant" when the dimension is declared but undefined', () => {
        const f = szv({
            // @ts-expect-error — a declared-but-undefined dimension
            variants: { size: undefined },
        });
        // @ts-expect-error — selecting a token for it
        expect(f({ size: 'sm' })).toEqual({});
        // The config check names the dimension first; with no values to
        // list, the selection's line offers none.
        expect(warn.mock.calls).toEqual([
            [configInvalidLine('dimension', 'undefined', 'size')],
            [unknownValueLine('size', 'sm', [])],
        ]);
    });
});
