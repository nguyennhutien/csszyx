/**
 * Flex and grid ITEM properties act on the outer side of the border line.
 *
 * `grow`, `order`, `self`, `colSpan` and their siblings describe how a box sits
 * among its siblings inside its parent's flex or grid container — the box's
 * relationship to its neighbours, which is the definition of outer. They were
 * routed inner with the container properties they share a category with, so a
 * `grow-1` landed on the content node, whose parent is the frame, not a flex
 * container: it did nothing, silently, unless the caller pre-split by hand.
 *
 * Container properties — direction, wrap, alignment of ITEMS, gap, the grid
 * template — still act inward, on the box's contents, and stay inner.
 */
import { describe, expect, it } from 'vitest';
import { classify, classifySzKey, splitBoxSz } from '../src/split-box.js';

/** Item properties, each with a value that emits a real utility. */
const ITEM = {
    basis: 'auto',
    flex: 1,
    grow: 1,
    shrink: 0,
    order: 'first',
    self: 'center',
    justifySelf: 'end',
    placeSelf: 'center',
    col: 'auto',
    colSpan: 2,
    colStart: 1,
    colEnd: 3,
    row: 'auto',
    rowSpan: 2,
    rowStart: 1,
    rowEnd: 3,
} as const;

/** Container properties on the same axes, which stay inner. */
const CONTAINER = {
    display: 'flex',
    flexDir: 'col',
    flexWrap: 'wrap',
    items: 'center',
    justify: 'between',
    justifyItems: 'start',
    placeContent: 'center',
    placeItems: 'start',
    gap: 2,
    gridCols: 3,
    gridRows: 2,
    gridFlow: 'row',
    autoCols: 'fr',
    autoRows: 'min',
} as const;

describe('flex and grid item properties', () => {
    it.each(Object.keys(ITEM))('%s is outer', key => {
        expect(classifySzKey(key)?.role).toBe('outer');
    });

    it.each(Object.keys(CONTAINER))('%s stays inner', key => {
        expect(classifySzKey(key)?.role).toBe('inner');
    });

    it('routes the item side to the frame and the container side to the content', () => {
        expect(splitBoxSz({ ...ITEM, ...CONTAINER, m: 4, p: 2 })).toEqual({
            outer: { ...ITEM, m: 4 },
            inner: { ...CONTAINER, p: 2 },
        });
    });

    // The emitted class agrees with the sz key: the token map is generated
    // from the same rules, and a splitBox on a className must partition the
    // way splitBoxSz partitions the object it was compiled from.
    it.each([
        ['grow-1', 'flex'],
        ['order-first', 'flex'],
        ['self-center', 'alignment'],
        ['col-span-2', 'grid'],
        ['basis-auto', 'flex'],
    ])('%s is an outer %s token', (token, category) => {
        expect(classify(token)).toEqual({ role: 'outer', category });
    });

    // The override still answers for the component whose CONTENT is the item:
    // a frame that is itself a flex container laying out one child.
    it('can be forced back to the content node', () => {
        expect(splitBoxSz({ grow: 1, p: 2 }, { inner: ['grow'] })).toEqual({
            outer: {},
            inner: { grow: 1, p: 2 },
        });
    });
});
