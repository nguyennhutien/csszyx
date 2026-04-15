import { describe, expect, it } from 'vitest';

import { szv } from '../src/variants.js';

const buttonSz = szv({
    base: { inlineFlex: true, items: 'center', rounded: 'md' },
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
            expect(result.inlineFlex).toBe(true);
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
            expect(result.inlineFlex).toBe(true); // base still present
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
