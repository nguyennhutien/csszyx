/**
 * Prefixes where a colour utility and a size/width/position utility share the
 * same name.
 *
 * `szcn` merges by utility prefix, and eight prefixes were already routed
 * through value classification because of exactly this problem (`text-sm` is a
 * size, `text-red-500` is a colour). Eight MORE have the same shape and were
 * never routed: `shadow-lg shadow-red-500` is the documented Tailwind way to
 * set a shadow's size and its colour, and szcn deleted the size.
 *
 * That direction is the one the module may never take. The fail-safe contract
 * is that classification errs toward keep-both — an extra class is harmless,
 * a deleted one silently removes styling the author wrote. These cases need no
 * custom theme at all; plain palette colours reproduce every one.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { szcn } from '../src/merge-classes.js';
import { _resetSzcnGroups, registerSzcnGroups } from '../src/merge-groups.js';

afterEach(() => {
    _resetSzcnGroups();
});

describe('a colour never deletes a size on the shadow utilities', () => {
    it.each([
        ['shadow-lg', 'shadow-red-500'],
        ['shadow-sm', 'shadow-black'],
        ['drop-shadow-lg', 'drop-shadow-red-500'],
        ['inset-shadow-sm', 'inset-shadow-red-500'],
    ])('keeps both in %s + %s', (size, color) => {
        expect(szcn(size, color)).toBe(`${size} ${color}`);
        // Order must not decide it either: the colour written first is just as
        // real as the size written first.
        expect(szcn(color, size)).toBe(`${color} ${size}`);
    });

    it.each([
        ['shadow-sm', 'shadow-lg'],
        ['drop-shadow-sm', 'drop-shadow-xl'],
        ['inset-shadow-xs', 'inset-shadow-sm'],
    ])('still merges two sizes, %s then %s', (first, second) => {
        expect(szcn(first, second)).toBe(second);
    });

    it('still merges two shadow colours', () => {
        expect(szcn('shadow-red-500', 'shadow-blue-500')).toBe('shadow-blue-500');
    });
});

describe('a colour never deletes a thickness or a style on decoration', () => {
    it('keeps thickness and colour apart', () => {
        expect(szcn('decoration-2', 'decoration-red-500')).toBe('decoration-2 decoration-red-500');
    });

    it('keeps line style and colour apart', () => {
        expect(szcn('decoration-solid', 'decoration-red-500')).toBe(
            'decoration-solid decoration-red-500',
        );
    });

    it('keeps thickness and line style apart', () => {
        expect(szcn('decoration-2', 'decoration-dashed')).toBe('decoration-2 decoration-dashed');
    });

    it('merges within each group', () => {
        expect(szcn('decoration-2', 'decoration-4')).toBe('decoration-4');
        expect(szcn('decoration-solid', 'decoration-wavy')).toBe('decoration-wavy');
        expect(szcn('decoration-red-500', 'decoration-blue-500')).toBe('decoration-blue-500');
    });
});

describe('a colour never deletes a width on stroke', () => {
    it('keeps width and colour apart', () => {
        expect(szcn('stroke-2', 'stroke-red-500')).toBe('stroke-2 stroke-red-500');
    });

    it('merges within each group', () => {
        expect(szcn('stroke-1', 'stroke-2')).toBe('stroke-2');
        expect(szcn('stroke-red-500', 'stroke-blue-500')).toBe('stroke-blue-500');
    });
});

describe('a colour never deletes a gradient stop position', () => {
    it.each(['from', 'via', 'to'])('keeps position and colour apart on %s-*', prefix => {
        expect(szcn(`${prefix}-10%`, `${prefix}-red-500`)).toBe(`${prefix}-10% ${prefix}-red-500`);
    });

    it.each(['from', 'via', 'to'])('merges within each group on %s-*', prefix => {
        expect(szcn(`${prefix}-10%`, `${prefix}-90%`)).toBe(`${prefix}-90%`);
        expect(szcn(`${prefix}-red-500`, `${prefix}-blue-500`)).toBe(`${prefix}-blue-500`);
    });
});

describe('custom theme tokens reach the new prefixes too', () => {
    it('treats a registered colour token as a colour, not a size', () => {
        registerSzcnGroups({ colors: ['brand'] });
        expect(szcn('shadow-lg', 'shadow-brand')).toBe('shadow-lg shadow-brand');
        expect(szcn('shadow-brand', 'shadow-accent')).toBe('shadow-brand shadow-accent');
        registerSzcnGroups({ colors: ['accent'] });
        expect(szcn('shadow-brand', 'shadow-accent')).toBe('shadow-accent');
    });

    it('refuses a colour token that shadows a shadow size keyword', () => {
        // A colour named `lg` would make `shadow-lg` classify as a colour and
        // merge away a real size — the same trap the blocklist already closes
        // for `bg-cover`.
        registerSzcnGroups({ colors: ['lg'] });
        expect(szcn('shadow-lg', 'shadow-red-500')).toBe('shadow-lg shadow-red-500');
    });
});

describe('an unclassifiable value stays keep-both', () => {
    it.each([
        ['shadow-(--custom)', 'shadow-red-500'],
        ['decoration-(--custom)', 'decoration-2'],
    ])('keeps both for %s + %s', (first, second) => {
        expect(szcn(first, second)).toBe(`${first} ${second}`);
    });
});
