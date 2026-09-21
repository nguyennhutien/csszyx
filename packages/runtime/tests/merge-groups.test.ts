/**
 * Value-set-aware merge groups: the vui field acceptance suite plus the
 * adversarial cases from the design review — every ambiguous prefix, the
 * custom-theme registration guard rails, variant scoping, and mangle parity.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOX_ROLE_TOKENS } from '../src/box-role-map.generated.js';
import { szcn } from '../src/merge-classes.js';
import {
    _resetSzcnGroups,
    getSzcnGroupsGeneration,
    registerSzcnGroups,
} from '../src/merge-groups.js';
import { sameGroup } from './helpers/same-group.js';
import { useTailwindMergeTable } from './helpers/tailwind-merge-table.js';

useTailwindMergeTable();

afterEach(() => {
    _resetSzcnGroups();
    (globalThis as { __csszyx?: unknown }).__csszyx = undefined;
    vi.restoreAllMocks();
});

describe('field acceptance suite (vui 0.10.10 item 7)', () => {
    it('same-group last-wins, different groups co-exist', () => {
        expect(szcn('text-base', 'text-sm')).toBe('text-sm');
        expect(szcn('text-sm', 'text-base')).toBe('text-base');
        expect(szcn('text-red-500', 'text-sm')).toBe('text-red-500 text-sm');
        expect(szcn('font-sans', 'font-bold')).toBe('font-sans font-bold');
        expect(szcn('font-semibold', 'font-normal')).toBe('font-normal');
        expect(szcn('bg-red-500', 'bg-cover')).toBe('bg-red-500 bg-cover');
        expect(szcn('border-2', 'border-red-500')).toBe('border-2 border-red-500');
    });

    it('groups are variant-scoped', () => {
        expect(szcn('md:text-base', 'md:text-sm')).toBe('md:text-sm');
        expect(szcn('text-base', 'md:text-sm')).toBe('text-base md:text-sm');
        expect(szcn('hover:bg-red-500', 'hover:bg-blue-500')).toBe('hover:bg-blue-500');
    });

    it('mangle parity: the same results when tokens arrive mangled', () => {
        const map: Record<string, string> = {
            'text-base': 'a1',
            'text-sm': 'a2',
            'text-red-500': 'a3',
            'font-sans': 'a4',
            'font-bold': 'a5',
        };
        const reverse = new Map(Object.entries(map).map(([k, v]) => [v, k]));
        (globalThis as { __csszyx?: unknown }).__csszyx = {
            decode: (token: string) => reverse.get(token),
        };
        expect(szcn('a1', 'a2')).toBe('a2'); // text-base + text-sm → text-sm (mangled)
        expect(szcn('a3', 'a2')).toBe('a3 a2'); // color + size co-exist
        expect(szcn('a4', 'a5')).toBe('a4 a5'); // family + weight co-exist
    });
});

describe('per-prefix classification', () => {
    it('text: size / align / wrap / overflow / color are distinct groups', () => {
        expect(szcn('text-center', 'text-right')).toBe('text-right');
        expect(szcn('text-center', 'text-sm')).toBe('text-center text-sm');
        expect(szcn('text-balance', 'text-pretty')).toBe('text-pretty');
        expect(szcn('text-ellipsis', 'text-clip')).toBe('text-clip');
        expect(szcn('text-red-500', 'text-blue-600')).toBe('text-blue-600');
        expect(szcn('text-white', 'text-black')).toBe('text-black');
    });

    it('text: line-height and opacity modifiers stay in their group', () => {
        expect(szcn('text-sm/6', 'text-lg/7')).toBe('text-lg/7');
        expect(szcn('text-red-500/50', 'text-blue-600')).toBe('text-blue-600');
    });

    it('text: arbitrary values classify by shape — length vs color', () => {
        expect(szcn('text-[13px]', 'text-sm')).toBe('text-sm');
        expect(szcn('text-[#fff]', 'text-red-500')).toBe('text-red-500');
        expect(szcn('text-[13px]', 'text-[#fff]')).toBe('text-[13px] text-[#fff]');
    });

    it('text: css-variable values stay keep-both (type unknown)', () => {
        expect(szcn('text-(--brand)', 'text-sm')).toBe('text-(--brand) text-sm');
    });

    it('explicit data-type hints classify css-variable values', () => {
        // `(color:--x)` / `[color:var(--x)]` DECLARE the type, so they merge
        // even though the var name itself is unknown — unlike the bare
        // `text-(--x)` above, which stays keep-both.
        expect(szcn('text-(color:--sub)', 'text-(color:--danger)')).toBe('text-(color:--danger)');
        expect(szcn('text-[color:var(--sub)]', 'text-[color:var(--danger)]')).toBe(
            'text-[color:var(--danger)]',
        );
        expect(szcn('text-(length:--compact)', 'text-(length:--roomy)')).toBe(
            'text-(length:--roomy)',
        );
        expect(szcn('bg-(color:--sub)', 'bg-(color:--danger)')).toBe('bg-(color:--danger)');
        expect(szcn('border-(color:--sub)', 'border-(color:--danger)')).toBe(
            'border-(color:--danger)',
        );
        // A color hint and a length hint are DIFFERENT properties — co-exist.
        expect(szcn('text-(color:--sub)', 'text-(length:--roomy)')).toBe(
            'text-(color:--sub) text-(length:--roomy)',
        );
        // Opacity modifier stays within the color group.
        expect(szcn('text-(color:--sub)/50', 'text-(color:--danger)')).toBe(
            'text-(color:--danger)',
        );
    });

    it('bg: seven groups', () => {
        expect(szcn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
        expect(szcn('bg-cover', 'bg-contain')).toBe('bg-contain');
        expect(szcn('bg-top', 'bg-center')).toBe('bg-center');
        expect(szcn('bg-repeat', 'bg-no-repeat')).toBe('bg-no-repeat');
        expect(szcn('bg-fixed', 'bg-scroll')).toBe('bg-scroll');
        expect(szcn('bg-clip-text', 'bg-clip-border')).toBe('bg-clip-border');
        expect(szcn('bg-red-500', 'bg-center', 'bg-cover')).toBe('bg-red-500 bg-center bg-cover');
    });

    it('border: width / style / color; directional stays keep-both (v1)', () => {
        expect(szcn('border-2', 'border-4')).toBe('border-4');
        expect(szcn('border', 'border-2')).toBe('border-2');
        expect(szcn('border-solid', 'border-dashed')).toBe('border-dashed');
        expect(szcn('border-red-500', 'border-2', 'border-solid')).toBe(
            'border-red-500 border-2 border-solid',
        );
        // `border-2` compiles to `border-width` and `border-style` for all four
        // sides, which covers what `border-t-2` set on the top one.
        expect(szcn('border-t-2', 'border-2')).toBe('border-2');
        // …but border-t is its own single-property prefix, so same-side widths
        // merge by prefix as they always did.
        expect(szcn('border-t-2', 'border-t-4')).toBe('border-t-4');
    });

    it('divide / ring / outline: axis and offset forms stay keep-both', () => {
        expect(szcn('divide-red-500', 'divide-blue-500')).toBe('divide-blue-500');
        expect(szcn('divide-x-2', 'divide-y-2')).toBe('divide-x-2 divide-y-2');
        expect(szcn('ring-2', 'ring-4')).toBe('ring-4');
        expect(szcn('ring-2', 'ring-red-500')).toBe('ring-2 ring-red-500');
        expect(szcn('outline-2', 'outline-red-500', 'outline-dashed')).toBe(
            'outline-2 outline-red-500 outline-dashed',
        );
    });

    it('flex: shorthand / direction / wrap', () => {
        expect(szcn('flex-1', 'flex-none')).toBe('flex-none');
        expect(szcn('flex-row', 'flex-col')).toBe('flex-col');
        expect(szcn('flex-wrap', 'flex-nowrap')).toBe('flex-nowrap');
        expect(szcn('flex-1', 'flex-row', 'flex-wrap')).toBe('flex-1 flex-row flex-wrap');
        // bare `flex` is display, not the flex- utility — never merged with them.
        expect(szcn('flex', 'flex-1')).toBe('flex flex-1');
    });

    it('unknown values stay keep-both (fail-safe)', () => {
        expect(szcn('text-shadow-sm', 'text-sm')).toBe('text-shadow-sm text-sm');
        expect(szcn('font-stretch-50%', 'font-bold')).toBe('font-stretch-50% font-bold');
        expect(szcn('bg-whatever-weird', 'bg-red-500')).toBe('bg-whatever-weird bg-red-500');
    });
});

describe('custom theme registration', () => {
    it('registered color tokens join the color group of every color prefix', () => {
        registerSzcnGroups({ colors: ['brand', 'tag-blue-bg'] });
        expect(sameGroup('text', 'brand', 'red-500')).toBe(true);
        expect(sameGroup('bg', 'brand', 'tag-blue-bg')).toBe(true);
        expect(sameGroup('border', 'brand', '2')).toBe(false);
    });

    it('two registered colors share a group on every color prefix', () => {
        // vui finding 7 was about merging: a later `text-danger` has to beat an
        // earlier `text-sub`. That now rests on the project's compiled `@theme`
        // and is proved against real Tailwind in the unplugin's
        // `merge-signature-model.test.ts`; here the registry's half remains.
        registerSzcnGroups({ colors: ['sub', 'danger'] });
        expect(sameGroup('text', 'sub', 'danger')).toBe(true);
        expect(sameGroup('bg', 'sub', 'danger')).toBe(true);
    });

    it('registered text sizes and font tokens dedupe', () => {
        registerSzcnGroups({
            textSizes: ['huge'],
            fontFamilies: ['display'],
            fontWeights: ['chunky'],
        });
        expect(sameGroup('text', 'huge', 'sm')).toBe(true);
        expect(sameGroup('text', 'huge', 'red-500')).toBe(false);
        expect(sameGroup('font', 'display', 'sans')).toBe(true);
        expect(sameGroup('font', 'display', 'chunky')).toBe(false);
    });

    it('unregistered custom tokens belong to no group', () => {
        expect(sameGroup('text', 'brand', 'accent')).toBe(false);
    });

    it('guard rail: a token shadowing a static keyword is rejected with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerSzcnGroups({ colors: ['cover'] });
        // bg-cover must still classify as background-SIZE, never a color.
        expect(sameGroup('bg', 'cover', 'red-500')).toBe(false);
        expect(sameGroup('bg', 'cover', 'contain')).toBe(true);
        expect(warn.mock.calls.some(c => String(c[0]).includes('"cover"'))).toBe(true);
    });

    it('guard rail: a token in two conflicting categories is dropped from both', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerSzcnGroups({ colors: ['huge'], textSizes: ['huge'] });
        expect(sameGroup('text', 'huge', 'sm')).toBe(false);
        expect(sameGroup('text', 'huge', 'red-500')).toBe(false);
        expect(warn.mock.calls.some(c => String(c[0]).includes('BOTH'))).toBe(true);
    });

    it('registration is additive and idempotent', () => {
        registerSzcnGroups({ colors: ['brand'] });
        registerSzcnGroups({ colors: ['brand', 'accent'] });
        expect(sameGroup('text', 'brand', 'accent')).toBe(true);
    });
});

describe('regression: previous under-merge behaviour that must stay', () => {
    it('exact duplicates still dedupe', () => {
        expect(szcn('text-sm', 'text-sm')).toBe('text-sm');
    });

    it('BEM-style app classes are never merged', () => {
        expect(szcn('text-item--active', 'text-sm')).toBe('text-item--active text-sm');
    });

    it('single-property prefixes still merge by prefix', () => {
        expect(szcn('gap-2', 'gap-8')).toBe('gap-8');
        expect(szcn('p-4', 'pb-2')).toBe('p-4 pb-2');
        expect(szcn('pb-2', 'p-4')).toBe('p-4');
    });
});

describe('QA expansion — edge cases from review', () => {
    it('registered custom color with an opacity modifier stays in the color group', () => {
        registerSzcnGroups({ colors: ['brand'] });
        expect(sameGroup('text', 'brand/50', 'blue-600')).toBe(true);
        expect(sameGroup('text', 'brand/50', 'sm')).toBe(false);
    });

    it('registered custom size with a line-height modifier stays in the size group', () => {
        registerSzcnGroups({ textSizes: ['huge'] });
        expect(sameGroup('text', 'huge/8', 'sm')).toBe(true);
    });

    it('shaded custom colors classify by SHAPE with no registration at all', () => {
        // `--color-brand-*` produces classes like text-brand-500 — the
        // {name}-{shade} shape is recognized without any registration.
        expect(sameGroup('text', 'brand-500', 'red-500')).toBe(true);
        expect(sameGroup('bg', 'brand-500', 'cover')).toBe(false);
    });

    it('stacked variants scope the group as one prefix', () => {
        expect(szcn('md:hover:text-sm', 'md:hover:text-base')).toBe('md:hover:text-base');
        expect(szcn('md:hover:text-sm', 'hover:text-base')).toBe(
            'md:hover:text-sm hover:text-base',
        );
    });

    it('arbitrary flex values classify as the shorthand group', () => {
        expect(szcn('flex-[2]', 'flex-1')).toBe('flex-1');
        expect(szcn('flex-[2]', 'flex-row')).toBe('flex-[2] flex-row');
    });

    it('important markers merge into the same group (later token is the intent)', () => {
        // Passing a later class IS the override intent, so `!text-sm` earlier
        // loses to a later `text-base` — same semantics single-property
        // prefixes have always had (normalizeBase strips the marker).
        // Importance is part of what a class declares, so neither side covers
        // the other; CSS lets the important one win wherever it stands.
        expect(szcn('!text-sm', 'text-base')).toBe('!text-sm text-base');
        expect(szcn('text-base', '!text-sm')).toBe('text-base !text-sm');
    });

    it('hostile registration input never throws and registers nothing wrong', () => {
        registerSzcnGroups({
            colors: [null as unknown as string, 42 as unknown as string, '', 'ok-token'],
        });
        expect(sameGroup('text', 'ok-token', 'red-500')).toBe(true);
        expect(sameGroup('text', '42', 'red-500')).toBe(false);
    });
});

describe('szcn memo invalidation (perf layer must never change results)', () => {
    it('a merge cached BEFORE the decode bridge appears is re-derived after it', () => {
        expect(szcn('q1', 'q2')).toBe('q1 q2'); // unknown tokens, cached
        const reverse = new Map([
            ['q1', 'gap-2'],
            ['q2', 'gap-8'],
        ]);
        (globalThis as { __csszyx?: unknown }).__csszyx = {
            decode: (token: string) => reverse.get(token),
        };
        expect(szcn('q1', 'q2')).toBe('q2'); // now mangle-aware: same utility, last wins
    });

    it('repeated hot calls return the identical result (memo hit path)', () => {
        const first = szcn('gap-2 p-4 text-sm', 'gap-8 text-base');
        for (let i = 0; i < 50; i++) {
            expect(szcn('gap-2 p-4 text-sm', 'gap-8 text-base')).toBe(first);
        }
        expect(first).toBe('p-4 gap-8 text-base');
    });
});

describe('generation bumps only on real registry changes', () => {
    it('an identical re-registration does not bump the generation', () => {
        registerSzcnGroups({ colors: ['brand'] });
        const generation = getSzcnGroupsGeneration();

        // Idempotent boot code and HMR re-executions replay the same
        // registration — the szcn memo must survive them.
        registerSzcnGroups({ colors: ['brand'] });
        expect(getSzcnGroupsGeneration()).toBe(generation);
    });

    it('registering a new name bumps the generation', () => {
        registerSzcnGroups({ colors: ['brand'] });
        const generation = getSzcnGroupsGeneration();

        registerSzcnGroups({ colors: ['accent'] });
        expect(getSzcnGroupsGeneration()).toBe(generation + 1);
    });

    it('a registration rejected by the collision blocklist does not bump', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerSzcnGroups({ colors: ['brand'] });
        const generation = getSzcnGroupsGeneration();

        registerSzcnGroups({ colors: ['cover'] }); // bg-cover is background-size
        expect(getSzcnGroupsGeneration()).toBe(generation);
        warn.mockRestore();
    });

    it('a cross-category ambiguity drop bumps (sets lost names)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerSzcnGroups({ colors: ['huge'] });
        const generation = getSzcnGroupsGeneration();

        registerSzcnGroups({ textSizes: ['huge'] }); // drops 'huge' from both
        expect(getSzcnGroupsGeneration()).toBe(generation + 1);
        warn.mockRestore();
    });

    it('an empty registration does not bump', () => {
        const generation = getSzcnGroupsGeneration();
        registerSzcnGroups({});
        expect(getSzcnGroupsGeneration()).toBe(generation);
    });
});

describe('cross-category ambiguity memory', () => {
    it('a later single-side registration cannot resurrect a dropped color', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerSzcnGroups({ colors: ['huge'] });
        registerSzcnGroups({ textSizes: ['huge'] }); // drops 'huge' from both

        // The theme still defines both meanings — re-registering one side in a
        // later batch (split manual calls, HMR replay) must stay keep-both.
        registerSzcnGroups({ colors: ['huge'] });
        expect(sameGroup('text', 'huge', 'red-500')).toBe(false);
        expect(sameGroup('text', 'huge', 'sm')).toBe(false);
        warn.mockRestore();
    });

    it('a rejected replay does not bump the generation', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerSzcnGroups({ colors: ['huge'] });
        registerSzcnGroups({ textSizes: ['huge'] });
        const generation = getSzcnGroupsGeneration();

        registerSzcnGroups({ colors: ['huge'] });
        expect(getSzcnGroupsGeneration()).toBe(generation);
        warn.mockRestore();
    });

    it('the font family/weight pair keeps the same memory', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerSzcnGroups({ fontFamilies: ['fancy'] });
        registerSzcnGroups({ fontWeights: ['fancy'] }); // drops 'fancy' from both

        registerSzcnGroups({ fontWeights: ['fancy'] });
        expect(sameGroup('font', 'fancy', 'bold')).toBe(false);
        expect(sameGroup('font', 'fancy', 'sans')).toBe(false);
        warn.mockRestore();
    });

    it('_resetSzcnGroups clears the memory', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerSzcnGroups({ colors: ['huge'] });
        registerSzcnGroups({ textSizes: ['huge'] });
        _resetSzcnGroups();

        // A fresh registry has no record of the old theme's ambiguity.
        registerSzcnGroups({ colors: ['huge'] });
        expect(sameGroup('text', 'huge', 'red-500')).toBe(true);
        warn.mockRestore();
    });
});

/**
 * `szcn` under-merges any token it finds in `BOX_ROLE_TOKENS`, because the
 * exact-token map was built for value-keyed SUGAR (`block`, `italic`), where
 * one category spans several CSS properties and merging by category would drop
 * a sibling. A closed-value key routed by value (`overflow-hidden` vs
 * `overflow-auto`) lands in the same map but is a single mutually-exclusive
 * property, so it must keep merging exactly as its prefix always did.
 *
 * These pairs are pinned BEFORE the box-role map grows those tokens: they are
 * the answers `szcn` gives today, and every one of them has to survive.
 */
describe('closed-value tokens keep merging as their prefix does', () => {
    // The first four are the pairs this block exists for: each token IS in
    // `BOX_ROLE_TOKENS`, so each one reaches the guard. Reverting the guard to
    // the old blanket `return null` turns exactly these four red.
    it.each([
        ['overflow-hidden', 'overflow-auto', 'overflow-auto'],
        ['overflow-x-hidden', 'overflow-x-auto', 'overflow-x-auto'],
        ['snap-start', 'snap-center', 'snap-center'],
        ['transform-3d', 'transform-flat', 'transform-flat'],
    ])('szcn(%s, %s) → %s', (a, b, expected) => {
        expect(szcn(a, b)).toBe(expected);
    });

    // These three never reach the guard and are here as the control group: they
    // are the neighbouring shapes a reader would expect to behave the same, and
    // they must keep doing so for a different reason. `align-*` and `cursor-*`
    // are not exact tokens at all — they classify through the prefix table —
    // and `flex` is an ambiguous prefix, resolved by the value classifier
    // before the exact-token guard is reached.
    it.each([
        ['align-top', 'align-middle', 'align-middle'],
        ['cursor-pointer', 'cursor-default', 'cursor-default'],
        ['flex-row', 'flex-col', 'flex-col'],
    ])('szcn(%s, %s) → %s, without reaching the guard', (a, b, expected) => {
        expect(BOX_ROLE_TOKENS.has(a)).toBe(a === 'flex-row');
        expect(szcn(a, b)).toBe(expected);
    });

    // Value-keyed sugar stays under-merged: `block` and `flex` are both
    // `display`, but the map holds tokens from several properties under that
    // one category, so collapsing them would drop a legitimate class.
    it('still under-merges display sugar', () => {
        expect(szcn('block', 'flex')).toBe('flex');
    });
});
