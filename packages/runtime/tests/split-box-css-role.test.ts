/**
 * The split runs along the CSS box-model border, so a property's side is the
 * side CSS itself puts it on: OUTER is the box as an item in its parent's
 * formatting context plus its own painting; INNER is the formatting context the
 * box establishes for its children.
 *
 * Two consequences the old per-category table got wrong, both measured in
 * Chromium before they were fixed:
 *
 * - `divide-*` draws borders BETWEEN a container's children, so on a frame with
 *   one child it paints nothing at all — 0 px of rule. It belongs inside.
 *   `inset-ring` / `inset-shadow`, conversely, paint on the border box of the
 *   element that declares them, which is the frame.
 * - `overflow` is two properties wearing one name. `hidden` and `clip` describe
 *   how the box is painted and clipped by its own frame; `auto` and `scroll`
 *   ask the box to become a scroll container for its children. A split that
 *   sends both inward leaves the frame unclipped and the scroller unbounded —
 *   the exact failure the docs' own ScrollArea recipe shipped with.
 */
import { transform } from '@csszyx/compiler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearMangleRegistry, installMangleRuntime } from '../src/mangle-registry.js';
import { szcn } from '../src/merge-classes.js';
import { classify, classifySzKey, has, pick, splitBox, splitBoxSz } from '../src/split-box.js';

/** `[sz key, value that emits a real utility, expected token, expected role]`. */
const MOVED: ReadonlyArray<readonly [string, string | number | boolean, string, string]> = [
    // Painted on the border box of the element that declares them: the frame.
    ['insetRing', 2, 'inset-ring-2', 'outer'],
    ['insetRingColor', 'red-500', 'inset-ring-red-500', 'outer'],
    ['insetShadow', 'sm', 'inset-shadow-sm', 'outer'],
    ['insetShadowColor', 'red-500', 'inset-shadow-red-500', 'outer'],
    // Borders BETWEEN children — a container property, so inside.
    ['divideX', 2, 'divide-x-2', 'inner'],
    ['divideY', 2, 'divide-y-2', 'inner'],
    ['divideColor', 'red-500', 'divide-red-500', 'inner'],
    ['divideStyle', 'dashed', 'divide-dashed', 'inner'],
    ['divideXReverse', true, 'divide-x-reverse', 'inner'],
    ['divideYReverse', true, 'divide-y-reverse', 'inner'],
    // Establish the 3D rendering context the CHILDREN are laid out in.
    ['perspective', 'near', 'perspective-near', 'inner'],
    ['perspectiveOrigin', 'top', 'perspective-origin-top', 'inner'],
    ['transformStyle', '3d', 'transform-3d', 'inner'],
    // Scroll margin is measured against the scrollport on the box itself, the
    // way `m-*` is measured against its parent: outer.
    ['scrollM', 4, 'scroll-m-4', 'outer'],
    ['scrollMt', 4, 'scroll-mt-4', 'outer'],
    ['scrollMx', 4, 'scroll-mx-4', 'outer'],
    ['scrollMbs', 4, 'scroll-mbs-4', 'outer'],
    // How THIS box snaps in its ancestor's scroll container.
    ['snapAlign', 'start', 'snap-start', 'outer'],
    ['snapStop', 'always', 'snap-always', 'outer'],
    // vertical-align positions this box in its parent's line box.
    ['align', 'top', 'align-top', 'outer'],
    // Hit testing and the pointer belong to the whole element, and the frame is
    // what the pointer meets first.
    ['cursor', 'pointer', 'cursor-pointer', 'outer'],
    ['pointerEvents', 'none', 'pointer-events-none', 'outer'],
    ['select', 'none', 'select-none', 'outer'],
    ['willChange', 'transform', 'will-change-transform', 'outer'],
];

/** Keys that share a prefix or a category with a moved key and must NOT move. */
const UNMOVED: ReadonlyArray<readonly [string, string | number, string, string]> = [
    ['snapType', 'x', 'snap-x', 'inner'],
    ['transform', 'gpu', 'transform-gpu', 'outer'],
    ['scroll', 'smooth', 'scroll-smooth', 'inner'],
    ['scrollP', 4, 'scroll-p-4', 'inner'],
    ['resize', 'none', 'resize-none', 'inner'],
    ['appearance', 'none', 'appearance-none', 'inner'],
    ['touch', 'pan-x', 'touch-pan-x', 'inner'],
    ['display', 'flex', 'flex', 'inner'],
    ['spaceX', 4, 'space-x-4', 'inner'],
];

describe('keys routed by their CSS formatting context', () => {
    it.each(MOVED)('%s is %s on both APIs', (key, value, token, role) => {
        expect(transform({ [key]: value }).className.trim()).toBe(token);
        expect(classifySzKey(key)?.role).toBe(role);
        expect(classify(token)?.role).toBe(role);
    });

    it.each(UNMOVED)('%s stays %s', (key, value, token, role) => {
        expect(transform({ [key]: value }).className.trim()).toBe(token);
        expect(classifySzKey(key)?.role).toBe(role);
        expect(classify(token)?.role).toBe(role);
    });

    it('keeps the category, so a category selector still reaches both sides', () => {
        expect(classifySzKey('divideX')?.category).toBe('divide');
        expect(classify('inset-ring-2')).toEqual({ role: 'outer', category: 'ring' });
        expect(classify('cursor-pointer')).toEqual({ role: 'outer', category: 'interaction' });
    });
});

describe('overflow routes by value', () => {
    it.each([
        ['overflow-hidden', 'outer'],
        ['overflow-clip', 'outer'],
        ['overflow-x-hidden', 'outer'],
        ['overflow-y-clip', 'outer'],
        ['overflow-auto', 'inner'],
        ['overflow-scroll', 'inner'],
        ['overflow-visible', 'inner'],
        ['overflow-y-auto', 'inner'],
        ['overflow-x-scroll', 'inner'],
    ])('%s is %s', (token, role) => {
        expect(classify(token)).toEqual({ role, category: 'overflow' });
    });

    it('reads through a variant prefix', () => {
        expect(classify('md:overflow-hidden')?.role).toBe('outer');
        expect(classify('hover:overflow-auto')?.role).toBe('inner');
    });

    // A value the compiler does not close over still classifies by the key's
    // default role, through the prefix that has always carried it.
    it('falls back to the key role for an arbitrary value', () => {
        expect(classify('overflow-[overlay]')).toEqual({ role: 'inner', category: 'overflow' });
        expect(classify('overflow-x-[overlay]')).toEqual({ role: 'inner', category: 'overflow' });
    });

    it('splits a clip and a scroller onto opposite nodes', () => {
        expect(splitBox('h-64 overflow-hidden overflow-y-auto p-4')).toEqual({
            outer: 'h-64 overflow-hidden',
            inner: 'overflow-y-auto p-4',
        });
    });

    it('partitions the sz object the same way', () => {
        expect(splitBoxSz({ overflow: 'hidden', p: 4 })).toEqual({
            outer: { overflow: 'hidden' },
            inner: { p: 4 },
        });
        expect(splitBoxSz({ overflow: 'auto' })).toEqual({
            outer: {},
            inner: { overflow: 'auto' },
        });
        expect(splitBoxSz({ md: { overflow: 'hidden' } })).toEqual({
            outer: { md: { overflow: 'hidden' } },
            inner: {},
        });
    });

    it('answers classifySzKey with and without the value', () => {
        expect(classifySzKey('overflow', 'hidden')?.role).toBe('outer');
        expect(classifySzKey('overflow', 'clip')?.role).toBe('outer');
        expect(classifySzKey('overflow', 'auto')?.role).toBe('inner');
        // No value to read: the key's own role, which is what every existing
        // caller of the one-argument form gets.
        expect(classifySzKey('overflow')?.role).toBe('inner');
        expect(classifySzKey('overflowY', 'clip')?.role).toBe('outer');
    });

    // A non-string value cannot be one of the closed spellings, so it takes the
    // key's role rather than throwing the lookup off.
    it('ignores a value that is not one of the closed spellings', () => {
        expect(splitBoxSz({ overflow: 1 as never })).toEqual({
            outer: {},
            inner: { overflow: 1 },
        });
    });

    it('still lets an override move it back', () => {
        expect(splitBox('overflow-hidden p-4', { inner: ['overflow'] })).toEqual({
            outer: '',
            inner: 'overflow-hidden p-4',
        });
        expect(splitBoxSz({ overflow: 'hidden', p: 4 }, { inner: ['overflow'] })).toEqual({
            outer: {},
            inner: { overflow: 'hidden', p: 4 },
        });
    });
});

describe('an exact token carries the value it was built from', () => {
    // `has(token, { category: value })` compared the whole class name against
    // the value for every exact token, so it answered false for every closed
    // value the map knows — the object selector worked only through prefixes.
    it.each([
        ['flex-col', { flex: 'col' }],
        ['overflow-hidden', { overflow: 'hidden' }],
        ['snap-center', { snap: 'center' }],
        ['transform-3d', { transform: '3d' }],
    ])('has(%s, %o)', (token, selector) => {
        expect(has(token, selector)).toBe(true);
    });

    it('and still says no to the wrong value', () => {
        expect(has('overflow-hidden', { overflow: 'auto' })).toBe(false);
        expect(has('flex-col', { flex: 'row' })).toBe(false);
    });

    it('leaves value-keyed sugar matching on its own name', () => {
        expect(has('block', { display: 'block' })).toBe(true);
    });
});

describe('szcn is unchanged by the new exact tokens', () => {
    it.each([
        ['overflow-hidden', 'overflow-auto', 'overflow-auto'],
        ['overflow-x-hidden', 'overflow-x-auto', 'overflow-x-auto'],
        ['overflow-[overlay]', 'overflow-auto', 'overflow-auto'],
        ['snap-start', 'snap-center', 'snap-center'],
        ['transform-3d', 'transform-flat', 'transform-flat'],
        ['align-top', 'align-middle', 'align-middle'],
        ['block', 'flex', 'block flex'],
    ])('szcn(%s, %s) → %s', (a, b, expected) => {
        expect(szcn(a, b)).toBe(expected);
    });

    it('keeps a string selector working for the prefix', () => {
        expect(pick('overflow-hidden p-4 overflow-x-auto', 'overflow')).toBe(
            'overflow-hidden overflow-x-auto',
        );
    });
});

describe('under a mangle registry', () => {
    /** A build where the tokens these tests read were renamed. */
    const MAP = {
        'overflow-hidden': 'a',
        'overflow-auto': 'b',
        'divide-x': 'c',
        'cursor-pointer': 'd',
    } as const;

    beforeEach(() => {
        clearMangleRegistry();
        installMangleRuntime({ mangleMap: MAP, checksum: 'css-role' });
    });

    afterEach(() => {
        clearMangleRegistry();
    });

    // Classified by the ORIGINAL name, emitted as the RAW token: the stylesheet
    // is mangled, so only the raw token matches a rule.
    it('routes a mangled token by the name it was mangled from', () => {
        expect(splitBox('a b c d')).toEqual({ outer: 'a d', inner: 'b c' });
    });

    it('answers the value selector through the registry', () => {
        expect(has('a', { overflow: 'hidden' })).toBe(true);
        expect(has('b', { overflow: 'hidden' })).toBe(false);
    });
});

describe('with no mangle registry installed', () => {
    beforeEach(() => {
        clearMangleRegistry();
    });

    // Mangling is off by default, so this is the path every build takes: the
    // bridge is undefined and the token is classified as written.
    it('gives the same partition for the original names', () => {
        expect(splitBox('overflow-hidden overflow-auto divide-x cursor-pointer')).toEqual({
            outer: 'overflow-hidden cursor-pointer',
            inner: 'overflow-auto divide-x',
        });
    });
});

/**
 * A transition is inert until a property changes. The change lives in a state
 * variant (`hover:`, `data-open:`) that the split routes by the property it
 * sets — a hover background goes to the frame, a hover colour to the content —
 * so a transition routed to one node leaves the other's change instant. The
 * token is present, the animation never runs, and nothing says why.
 *
 * `animate-*` shares the same category and is deliberately NOT cloned: an
 * animation runs the moment it lands, so two copies would run it twice.
 */
describe('transition properties are declared on both nodes', () => {
    it('clones the timing group, routing everything else once', () => {
        expect(
            splitBox(
                'transition-colors duration-300 ease-out delay-100 hover:bg-red-500 hover:text-white',
            ),
        ).toEqual({
            outer: 'transition-colors duration-300 ease-out delay-100 hover:bg-red-500',
            inner: 'transition-colors duration-300 ease-out delay-100 hover:text-white',
        });
    });

    it('clones transition-discrete, which shares the prefix', () => {
        expect(splitBox('transition-discrete')).toEqual({
            outer: 'transition-discrete',
            inner: 'transition-discrete',
        });
    });

    it('leaves an animation on one node', () => {
        expect(splitBox('animate-spin')).toEqual({ outer: 'animate-spin', inner: '' });
    });

    it('clones on the sz side too, through a variant container', () => {
        expect(
            splitBoxSz({
                transition: 'colors',
                duration: 300,
                hover: { bg: 'red-500', color: 'white' },
                md: { transition: 'all' },
            }),
        ).toEqual({
            outer: {
                transition: 'colors',
                duration: 300,
                hover: { bg: 'red-500' },
                md: { transition: 'all' },
            },
            inner: {
                transition: 'colors',
                duration: 300,
                hover: { color: 'white' },
                md: { transition: 'all' },
            },
        });
    });

    it('lets an override pin it to one node', () => {
        expect(splitBox('transition-colors', { inner: ['transition'] })).toEqual({
            outer: '',
            inner: 'transition-colors',
        });
        expect(splitBox('transition-colors', { outer: ['transition'] })).toEqual({
            outer: 'transition-colors',
            inner: '',
        });
        expect(splitBoxSz({ transition: 'colors' }, { inner: ['transition'] })).toEqual({
            outer: {},
            inner: { transition: 'colors' },
        });
    });
});
