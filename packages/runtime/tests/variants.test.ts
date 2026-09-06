import { describe, expect, it, vi } from 'vitest';

import { szv } from '../src/variants.js';

const buttonSz = szv({
    base: { display: 'inline-flex', items: 'center', rounded: 'md' },
    variants: {
        variant: {
            default: { bg: 'primary', text: 'primary-foreground' },
            outline: { border: true, borderColor: 'blue-500' },
            ghost: { hover: { bg: 'accent' } },
        },
        size: {
            sm: { h: 9, px: 3 },
            md: { h: 10, px: 4 },
            lg: { h: 11, px: 8 },
        },
    },
    defaultVariants: { variant: 'default', size: 'md' },
});

describe('szv()', () => {
    describe('base + defaultVariants', () => {
        it('no selection → base + defaultVariants applied', () => {
            const result = buttonSz();
            expect(result.display).toBe('inline-flex');
            expect(result.items).toBe('center');
            expect(result.rounded).toBe('md');
            expect(result.bg).toBe('primary'); // from default variant
            expect(result.h).toBe(10); // from md size
        });

        it('empty selection → same as no selection', () => {
            expect(buttonSz({})).toEqual(buttonSz());
        });
    });

    describe('variant selection', () => {
        it('override variant overrides defaultVariant', () => {
            const result = buttonSz({ variant: 'outline' });
            expect(result.border).toBe(true);
            expect(result.borderColor).toBe('blue-500');
            expect(result.bg).toBeUndefined(); // outline has no bg
        });

        it('override size keeps base and variant', () => {
            const result = buttonSz({ size: 'sm' });
            expect(result.h).toBe(9);
            expect(result.px).toBe(3);
            expect(result.display).toBe('inline-flex'); // base still present
            expect(result.bg).toBe('primary'); // default variant still applied
        });

        it('both overridden', () => {
            const result = buttonSz({ variant: 'outline', size: 'lg' });
            expect(result.border).toBe(true);
            expect(result.h).toBe(11);
        });
    });

    describe('deep merge of nested objects', () => {
        const cardSz = szv({
            base: { rounded: 'lg', hover: { shadow: 'md' } },
            variants: {
                color: {
                    blue: { bg: 'blue-50', hover: { bg: 'blue-100' } },
                    red: { bg: 'red-50', hover: { bg: 'red-100' } },
                },
            },
        });

        it('base hover and variant hover are deep merged, not overwritten', () => {
            const result = cardSz({ color: 'blue' });
            const hover = result.hover as Record<string, unknown>;
            expect(hover.shadow).toBe('md'); // from base
            expect(hover.bg).toBe('blue-100'); // from variant
        });
    });

    describe('null / undefined selection', () => {
        it('null variant value falls back to defaultVariant', () => {
            const result = buttonSz({ variant: null });
            expect(result.bg).toBe('primary'); // default still applied
        });

        it('undefined variant value falls back to defaultVariant', () => {
            const result = buttonSz({ variant: undefined });
            expect(result.bg).toBe('primary');
        });
    });

    describe('no base', () => {
        it('works without base', () => {
            const pill = szv({
                variants: { size: { sm: { px: 2, py: 1 }, lg: { px: 4, py: 2 } } },
                defaultVariants: { size: 'sm' },
            });
            expect(pill().px).toBe(2);
            expect(pill({ size: 'lg' }).px).toBe(4);
        });
    });
});

describe('szv base-only configs', () => {
    it('returns the base without any warning', () => {
        const warnings: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((msg: string) => {
            warnings.push(String(msg));
        });
        try {
            const titleSz = szv({ base: { weight: 'semibold', text: 'base' } });
            expect(titleSz()).toEqual({ weight: 'semibold', text: 'base' });
            expect(
                warnings.filter(w => w.includes('variants')),
                'a base-only config is valid and must not warn',
            ).toEqual([]);
        } finally {
            spy.mockRestore();
        }
    });

    it('still warns when variants is present but mis-typed', () => {
        const warnings: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((msg: string) => {
            warnings.push(String(msg));
        });
        try {
            szv({ base: { p: 2 }, variants: 'nope' as never });
            expect(warnings.some(w => w.includes('variants must be an object'))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('szv output string-coercion guard (dev)', () => {
    it('warns and yields an empty string when the object lands in className', () => {
        const warnings: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((msg: string) => {
            warnings.push(String(msg));
        });
        try {
            const boxSz = szv({ variants: { v: { x: { p: 2 } } } });
            // Stringifying the object IS the case under test: a caller who
            // forgets to spread the factory's result gets `[object Object]` in
            // their className, and the warning below is what tells them.
            // eslint-disable-next-line @typescript-eslint/no-base-to-string
            const coerced = String(boxSz({ v: 'x' }));
            expect(coerced).toBe('');
            expect(warnings.some(w => w.includes('[object Object]'))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });

    it('the trap is invisible to spreads, entries, and JSON', () => {
        const boxSz = szv({ base: { m: 1 }, variants: { v: { x: { p: 2 } } } });
        const out = boxSz({ v: 'x' });
        expect({ ...out }).toEqual({ m: 1, p: 2 });
        expect(Object.keys(out)).toEqual(['m', 'p']);
        expect(JSON.parse(JSON.stringify(out))).toEqual({ m: 1, p: 2 });
    });
});
