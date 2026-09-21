/**
 * The CSS half of "does this class write over that one".
 *
 * The merge compares the properties two classes set, and that comparison is
 * only right if it knows `padding` is the four `padding-*` and `border` reaches
 * all the way down to `border-top-width`. That relation is CSS, not Tailwind,
 * so the table is generated from `mdn-data` and these cases pin the shapes the
 * merge depends on — including the transitive one, which is where a hand-kept
 * list would stop.
 */
import { describe, expect, it } from 'vitest';

import { LONGHANDS } from '../src/longhand-table.generated.js';

describe('the generated shorthand table', () => {
    it('expands the box shorthands to their four sides', () => {
        expect(LONGHANDS.get('padding')).toEqual([
            'padding-bottom',
            'padding-left',
            'padding-right',
            'padding-top',
        ]);
        expect(LONGHANDS.get('margin')).toHaveLength(4);
        expect(LONGHANDS.get('inset')).toEqual(['bottom', 'left', 'right', 'top']);
    });

    it('expands the families the hand-kept list was measured missing', () => {
        expect(LONGHANDS.get('gap')).toEqual(['column-gap', 'row-gap']);
        expect(LONGHANDS.get('scroll-margin')).toHaveLength(4);
        expect(LONGHANDS.get('scroll-padding')).toHaveLength(4);
    });

    it('follows a shorthand of shorthands to the leaves', () => {
        // `border` → `border-width` → the four side widths. A one-step table
        // would answer `border-width`, which never matches what a side utility
        // writes, so `border-2` would not be seen to cover `border-t-2`.
        const border = LONGHANDS.get('border');
        expect(border).toContain('border-top-width');
        expect(border).toContain('border-bottom-color');
        expect(border).not.toContain('border-width');
    });

    it('leaves a plain property out', () => {
        // `width` has a `computed` sentence in the dataset, not an expansion.
        expect(LONGHANDS.has('width')).toBe(false);
        expect(LONGHANDS.has('color')).toBe(false);
    });

    it('keeps every expansion sorted and free of duplicates', () => {
        for (const [name, parts] of LONGHANDS) {
            expect([...parts], name).toEqual([...new Set(parts)].sort());
        }
    });

    it('never lists a property as its own longhand', () => {
        for (const [name, parts] of LONGHANDS) {
            expect(parts, name).not.toContain(name);
        }
    });
});
