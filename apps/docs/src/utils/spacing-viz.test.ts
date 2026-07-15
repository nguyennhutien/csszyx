import { describe, expect, it } from 'vitest';

import { resolveMarginViz, resolvePaddingKind } from './spacing-viz.js';

describe('resolveMarginViz', () => {
    it('returns null for padding-only inputs', () => {
        expect(resolveMarginViz({ p: 4 })).toBeNull();
    });

    it('preserves edge precedence and absolute magnitude', () => {
        expect(resolveMarginViz({ mr: -4, ml: 2, my: 8 })).toEqual({
            direction: 'right',
            magnitude: 4,
            horizontal: true,
        });
        expect(resolveMarginViz({ mb: 6 })).toEqual({
            direction: 'bottom',
            magnitude: 6,
            horizontal: false,
        });
    });

    it('maps axis and all-side margins to their display direction', () => {
        expect(resolveMarginViz({ mx: 2 })?.direction).toBe('right');
        expect(resolveMarginViz({ my: 2 })?.direction).toBe('bottom');
        expect(resolveMarginViz({ m: 4 })?.direction).toBe('right');
    });
});

describe('resolvePaddingKind', () => {
    it('uses the established prop precedence', () => {
        expect(resolvePaddingKind({ p: 4, px: 6 })).toBe('p');
        expect(resolvePaddingKind({ pt: 4, pl: 2 })).toBe('pt');
        expect(resolvePaddingKind({ pe: 4, pl: 2 })).toBe('pe');
        expect(resolvePaddingKind({})).toBe('none');
    });
});
