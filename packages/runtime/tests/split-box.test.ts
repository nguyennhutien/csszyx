import { describe, expect, it } from 'vitest';
import { PROPERTY_MAP } from '@csszyx/compiler';
import {
    BOX_ROLE_PREFIXES,
    BOX_ROLE_TOKENS,
} from '../src/box-role-map.generated.js';
import { classify, has, omit, pick, splitBox } from '../src/split-box.js';

describe('splitBox', () => {
    it('partitions at the border line (the report case)', () => {
        expect(splitBox('m-4 px-2')).toEqual({ outer: 'm-4', inner: 'px-2' });
    });

    it('keeps variant prefixes and classifies the base', () => {
        expect(splitBox('md:px-2 hover:shadow-lg')).toEqual({
            outer: 'hover:shadow-lg',
            inner: 'md:px-2',
        });
    });

    it('handles deep / arbitrary variants without splitting the value', () => {
        const r = splitBox('@max-[600px]:p-4 [&:hover]:m-2 aria-[sort=asc]:flex');
        expect(r.inner).toBe('@max-[600px]:p-4 aria-[sort=asc]:flex');
        expect(r.outer).toBe('[&:hover]:m-2');
    });

    it('routes the contested defaults', () => {
        // sizing → outer, display → inner, bg → outer, overflow → inner, visibility → outer
        const r = splitBox('w-full flex bg-white overflow-hidden invisible p-2 m-2');
        expect(r.outer.split(' ').sort()).toEqual(
            ['bg-white', 'invisible', 'm-2', 'w-full'].sort(),
        );
        expect(r.inner.split(' ').sort()).toEqual(
            ['flex', 'overflow-hidden', 'p-2'].sort(),
        );
    });

    it('routes value-keyed tokens (display/position/decoration)', () => {
        expect(splitBox('absolute block underline')).toEqual({
            outer: 'absolute',
            inner: 'block underline',
        });
    });

    it('honors negative and important markers', () => {
        expect(splitBox('-mt-4 px-2! !flex')).toEqual({
            outer: '-mt-4',
            inner: 'px-2! !flex',
        });
    });

    it('sends unknown tokens to the fallback (default outer)', () => {
        expect(splitBox('not-a-csszyx-class px-2')).toEqual({
            outer: 'not-a-csszyx-class',
            inner: 'px-2',
        });
        expect(
            splitBox('not-a-csszyx-class', { fallback: 'inner' }).inner,
        ).toBe('not-a-csszyx-class');
    });

    it('lets options override the default map', () => {
        // force bg (default outer) to inner
        expect(splitBox('bg-white m-2', { inner: ['bg'] })).toEqual({
            outer: 'm-2',
            inner: 'bg-white',
        });
        // force a category to outer
        expect(splitBox('overflow-hidden', { outer: ['overflow'] }).outer).toBe(
            'overflow-hidden',
        );
        // a class-prefix selector works as an override too
        expect(splitBox('px-2', { outer: ['px'] }).outer).toBe('px-2');
    });

    it('never loses or duplicates a token', () => {
        const input =
            'm-4 px-2 md:flex bg-red-500 w-1/2 hover:opacity-50 grid gap-2 -z-10 underline truncate';
        const { outer, inner } = splitBox(input);
        const back = `${outer} ${inner}`.split(/\s+/).filter(Boolean).sort();
        expect(back).toEqual(input.split(/\s+/).filter(Boolean).sort());
    });
});

describe('classify', () => {
    it('returns role + category for owned tokens', () => {
        expect(classify('px-2')).toEqual({ role: 'inner', category: 'padding' });
        expect(classify('m-4')).toEqual({ role: 'outer', category: 'margin' });
        expect(classify('inset-ring-2')).toEqual({
            role: 'inner',
            category: 'ring',
        });
        expect(classify('hover:bg-red-500')).toEqual({
            role: 'outer',
            category: 'bg',
        });
        expect(classify('absolute')).toEqual({
            role: 'outer',
            category: 'position',
        });
    });

    it('prefers the longest prefix (inset-ring over inset)', () => {
        expect(classify('inset-2')?.category).toBe('position');
        expect(classify('inset-ring-2')?.category).toBe('ring');
    });

    it('returns undefined for non-csszyx tokens', () => {
        expect(classify('totally-custom')).toBeUndefined();
        expect(classify('')).toBeUndefined();
    });
});

describe('toolkit: has / pick / omit', () => {
    const outer = 'm-4 bg-white overflow-hidden';
    const inner = 'p-2 overflow-y-auto flex';

    it('has() matches by role, category, prefix and {category:value}', () => {
        expect(has(outer, 'outer')).toBe(true);
        expect(has(outer, 'bg')).toBe(true);
        expect(has(outer, { overflow: 'hidden' })).toBe(true);
        expect(has(outer, { overflow: 'auto' })).toBe(false);
        expect(has('px-2 py-4', 'px')).toBe(true);
        expect(has(inner, 'content')).toBe(true); // box-layer alias = inner
    });

    it('pick() keeps only matching tokens', () => {
        expect(pick('m-4 p-2 bg-white', 'outer').split(' ').sort()).toEqual(
            ['bg-white', 'm-4'].sort(),
        );
        expect(pick(inner, 'overflow')).toBe('overflow-y-auto');
    });

    it('omit() drops matching tokens', () => {
        expect(omit(inner, 'overflow')).toBe('p-2 flex');
        expect(omit('m-4 bg-white', 'bg')).toBe('m-4');
    });

    it('the report scroll-dependency pattern composes', () => {
        // A scroll frame keeps the clip on the outer node, so the project routes
        // overflow to outer, then derives the inner scroller from it.
        const { outer: o, inner: i } = splitBox('overflow-hidden p-4', {
            outer: ['overflow'],
        });
        const dep = has(o, { overflow: 'hidden' }) ? 'overflow-y-auto' : '';
        expect(o).toBe('overflow-hidden');
        expect(`${i} ${dep}`.trim()).toBe('p-4 overflow-y-auto');
    });
});

describe('anti-drift coverage gate', () => {
    it('classifies every PROPERTY_MAP emitted prefix', () => {
        const prefixes = new Set(BOX_ROLE_PREFIXES.map(([p]) => p));
        const missing = Object.values(PROPERTY_MAP).filter(
            (prefix) => !prefixes.has(prefix),
        );
        expect(missing).toEqual([]);
    });

    it('has both buckets and no empty roles', () => {
        const roles = new Set([
            ...[...BOX_ROLE_TOKENS.values()].map((e) => e.role),
            ...BOX_ROLE_PREFIXES.map(([, e]) => e.role),
        ]);
        expect(roles).toEqual(new Set(['outer', 'inner']));
    });
});
