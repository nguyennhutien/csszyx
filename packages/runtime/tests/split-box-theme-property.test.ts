/**
 * `classify` answers with the CSS property, including for `@theme` tokens.
 *
 * csszyx already computes the finer answer: `szcn` classifies a token's VALUE
 * into a property group (`merge-groups.ts`) and knows the names an app declared
 * in its Tailwind `@theme`, because the build injects `setSzcnGroups` into every
 * module that calls `szcn(`. `classify` threw that away and answered `text` for
 * `text-red-500`, `text-sm` and `font-bold` alike — one product, two answers
 * about the same token.
 *
 * Two traps have their own describe blocks below, because both are ways this
 * feature can look right and be wrong:
 *
 * 1. The two consumers fail safe in OPPOSITE directions. For `szcn`, `null`
 *    means keep both classes. For `classify`, it must mean "fall back to the
 *    coarse category", i.e. no `property` at all — never `null`, never `''`.
 * 2. `classify` is memoized per token. Reading the theme registry makes the
 *    answer depend on something that changes at runtime (a rebuild, an HMR
 *    theme edit, a test registering groups), so the memo has to notice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetDevWarnCache } from '../src/dev-warn.js';
import { _resetSzcnGroups, clearSzcnGroups, registerSzcnGroups } from '../src/merge-groups.js';
import { classify, has, omit, pick, splitBox } from '../src/split-box.js';

afterEach(() => {
    _resetSzcnGroups();
    resetDevWarnCache();
});

describe('classify names the property under an ambiguous prefix', () => {
    it('separates a text colour from a text size', () => {
        expect(classify('text-red-500')).toStrictEqual({
            role: 'inner',
            category: 'text',
            property: 'color',
        });
        expect(classify('text-sm')).toStrictEqual({
            role: 'inner',
            category: 'text',
            property: 'size',
        });
    });

    it('separates a font weight from a font family', () => {
        expect(classify('font-bold')).toStrictEqual({
            role: 'inner',
            category: 'text',
            property: 'weight',
        });
        expect(classify('font-sans')).toStrictEqual({
            role: 'inner',
            category: 'text',
            property: 'family',
        });
    });

    it('separates a background size from a background colour', () => {
        expect(classify('bg-cover')).toStrictEqual({
            role: 'outer',
            category: 'bg',
            property: 'size',
        });
        expect(classify('bg-red-500')).toStrictEqual({
            role: 'outer',
            category: 'bg',
            property: 'color',
        });
    });

    it('reads a multi-segment prefix as one family', () => {
        // `inset-shadow` must not be read as the `inset` prefix plus a
        // `shadow-sm` value — that is a different family with different
        // properties.
        expect(classify('inset-shadow-sm')).toStrictEqual({
            role: 'outer',
            category: 'shadow',
            property: 'size',
        });
    });
});

describe('classify keeps the coarse answer when the property is not certain', () => {
    it('says nothing about a prefix that means exactly one property', () => {
        // `p-4` is padding, whatever the value. There is no finer answer to
        // give, so the field must be absent rather than invented.
        expect(classify('p-4')).toStrictEqual({ role: 'inner', category: 'padding' });
    });

    it('leaves the field absent, not null or empty, for an unclassifiable value', () => {
        // TRAP 1. `classifyAmbiguousValue` returns `null` here, which for szcn
        // means "keep both classes". Passing that value through would make
        // `property` a third state consumers have to handle.
        const info = classify('text-foo');
        expect(info).toStrictEqual({ role: 'inner', category: 'text' });
        expect(Object.hasOwn(info as object, 'property')).toBe(false);
    });

    it('leaves the field absent for a directional border, which szcn keeps both of', () => {
        const info = classify('border-t-2');
        expect(info?.role).toBe('outer');
        expect(info?.category).toBe('border');
        expect(Object.hasOwn(info as object, 'property')).toBe(false);
    });
});

describe('classify sees the tokens the app declared in @theme', () => {
    it('names the property of a custom colour, size and weight', () => {
        registerSzcnGroups({ colors: ['brand'], textSizes: ['huge'], fontWeights: ['chunky'] });

        expect(classify('text-brand')?.property).toBe('color');
        expect(classify('text-huge')?.property).toBe('size');
        expect(classify('font-chunky')?.property).toBe('weight');
        expect(classify('bg-brand')?.property).toBe('color');
    });

    it('leaves an undeclared token coarse', () => {
        registerSzcnGroups({ colors: ['brand'] });

        expect(Object.hasOwn(classify('text-unheard-of') as object, 'property')).toBe(false);
    });
});

describe('a theme registered after the first classify is not served stale', () => {
    it('picks up a registration made after the token was classified once', () => {
        // TRAP 2. The per-token memo used to be a pure function of the static
        // tables and the mangle bridge. Reading the theme registry breaks that,
        // and the memo would keep serving the answer from before the theme
        // existed.
        expect(classify('text-brand')).toStrictEqual({ role: 'inner', category: 'text' });

        registerSzcnGroups({ colors: ['brand'] });

        expect(classify('text-brand')).toStrictEqual({
            role: 'inner',
            category: 'text',
            property: 'color',
        });
    });

    it('drops the property again when the registration goes away', () => {
        registerSzcnGroups({ colors: ['brand'] });
        expect(classify('text-brand')?.property).toBe('color');

        clearSzcnGroups();

        expect(Object.hasOwn(classify('text-brand') as object, 'property')).toBe(false);
    });
});

describe('a theme registration never moves a token between the two nodes', () => {
    it('partitions a className identically before and after registering', () => {
        // The box role comes from the generated table, which no `@theme`
        // namespace can reach: the only role-splitting prefixes are the
        // `overflow` family, and `--overflow-*` is not a theme namespace.
        // `property` is extra information about a token, never a vote on where
        // it goes.
        const expected = { outer: 'bg-brand m-2', inner: 'text-brand p-4' };
        expect(splitBox('text-brand bg-brand p-4 m-2')).toEqual(expected);

        registerSzcnGroups({ colors: ['brand'] });

        expect(splitBox('text-brand bg-brand p-4 m-2')).toEqual(expected);
        // …and the registration did reach classification, so the pin above is
        // not passing because nothing changed at all.
        expect(classify('text-brand')?.property).toBe('color');
    });
});

describe('a selector can name the property', () => {
    it('keeps text colours without text sizes', () => {
        expect(pick('text-red-500 text-sm font-bold', 'text:color')).toBe('text-red-500');
        expect(omit('text-red-500 text-sm', 'text:color')).toBe('text-sm');
        expect(has('text-red-500', 'text:color')).toBe(true);
        expect(has('text-sm', 'text:color')).toBe(false);
    });

    it('qualifies a class prefix as readily as a category', () => {
        // `font-bold` is in the `text` category, so `font:weight` is the way to
        // address the weight without the rest of the typography.
        expect(pick('font-bold font-sans text-sm', 'font:weight')).toBe('font-bold');
    });

    it('qualifies a role as readily as a category', () => {
        expect(pick('bg-red-500 bg-cover m-2', 'outer:color')).toBe('bg-red-500');
        expect(has('bg-cover', 'outer:size')).toBe(true);
    });

    it('reaches a token the app declared in @theme', () => {
        registerSzcnGroups({ colors: ['brand'], textSizes: ['huge'] });

        expect(pick('text-brand text-huge', 'text:color')).toBe('text-brand');
    });

    it('says nothing when the selector is a class with a colon in its value', () => {
        // `bg-[url(https://x/y.png)]` is a class, not a qualified selector; the
        // literal-name escape hatch has to keep working for it.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(
            splitBox('bg-[url(https://x/y.png)]', { inner: ['bg-[url(https://x/y.png)]'] }),
        ).toEqual({ outer: '', inner: 'bg-[url(https://x/y.png)]' });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it.each(['text:colour', 'stroke:paint', 'text:fontSize'])(
        'diagnoses the unknown property half in %s',
        selector => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                expect(has('text-red-500', selector)).toBe(false);
                expect(pick('text-red-500', selector)).toBe('');
                expect(omit('text-red-500', selector)).toBe('text-red-500');
                expect(warn).toHaveBeenCalledExactlyOnceWith(
                    expect.stringContaining(
                        `'${selector.split(':')[1]}' is not a property csszyx tells apart`,
                    ),
                );
                expect(warn.mock.calls[0]?.[0]).toContain('help: the properties are');
            } finally {
                warn.mockRestore();
            }
        },
    );

    it('still warns when the half before the colon names nothing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(has('text-red-500', 'widht:color')).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('widht'));
        warn.mockRestore();
    });
});

it.each(['clip', 'ellipsis'])('classifies text-%s by the shared overflow group', value => {
    expect(classify(`text-${value}`)).toStrictEqual({
        role: 'inner',
        category: 'text',
        property: 'overflow',
    });
    expect(pick(`md:text-${value} text-red-500`, 'text:overflow')).toBe(`md:text-${value}`);
});
