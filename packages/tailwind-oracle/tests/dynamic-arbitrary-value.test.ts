/**
 * The value `dynamic()` writes for an arbitrary or variable class, asked of
 * the Tailwind this repository installs.
 *
 * Tailwind decodes a bracket before it writes it: a type hint (`length:`,
 * `color:`) names the value and is dropped, `_` is a space except inside
 * `url()` and the variable name a `var()` starts with, and `\_` is an `_`. A
 * parenthesis holds a variable and nothing else. `dynamic()` writes its own
 * rule for a class the build did not serve, so each declaration it writes is
 * one Tailwind writes for the same class.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    COLOR_PROPS,
    generateDeclarations,
    SPACING_PROPS,
} from '../../dynamic/src/css-generator.js';
import { createEmittedClassOracle } from '../src/index.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

/** Classes `dynamic()` writes a rule for. */
const SERVED = [
    // A variable's name keeps its `_`; what follows its comma does not.
    'bg-(--my_color)',
    'bg-[var(--my_color)]',
    'bg-[color:var(--my_color)]',
    'w-(--s,_1rem)',
    'w-(length:--a_b)',
    'w-[calc(var(--a_b)_+_1px)]',
    'w-[var(--a,var(--b_c,_2px))]',
    'w-[calc(1px_+_var(--x_y))]',
    'w-[min(var(--a_b),_calc(100%_-_2px))]',
    'w-[var(--a_b,calc(1px_+_2px))]',
    'w-[calc(1px_+_var(--x_y,_2px))]',
    'w-[var(--a_b,var(--c_d))]',
    // A call after `/` or `:` is still a call (Tailwind's words end there).
    'rounded-[1px/var(--a_b)]',
    'rounded-[var(--a_b)/var(--c_d)]',
    // An arbitrary property decodes its value, never its name.
    '[margin-top:var(--a_b)]',
    '[--x:var(--a_b)]',
    '[mask-image:url(a_b.png)]',
    '[background:center/url(a_b.png)]',
    // A type hint on any resolver.
    'p-[length:2rem]',
    'w-[length:10px]',
    'bg-(color:--c)',
    'bg-[color:#f00]',
    'text-(color:--c)',
    'text-[length:2rem]',
    'border-[length:3px]',
    'rounded-[length:4px]',
    'rounded-[calc(1px_+_2px)]',
    'font-[family-name:Inter]',
    // On `font`, any hint but a family's names the weight.
    'font-[weight:var(--w)]',
    'font-[number:var(--w)]',
    'font-[weight:bold]',
    'font-[generic-name:serif]',
    'rotate-[angle:45deg]',
    'leading-[length:2]',
    'tracking-[length:1px]',
    'opacity-[number:0.5]',
    'z-[integer:5]',
    'grid-cols-[length:100px]',
    'grid-cols-[repeat(2,_minmax(0,_1fr))]',
    'duration-[time:200ms]',
    // A colour on a shadow key is the shadow's colour.
    'shadow-[#f00]',
    'shadow-[color:#f00]',
    'shadow-[rgb(0_0_0)]',
    'shadow-[red]',
    'shadow-(color:--s)',
];

/**
 * Every type hint Tailwind reads, and one it does not (`weight`), which a
 * shared prefix reads as its colour.
 */
const HINTS = [
    'color',
    'length',
    'percentage',
    'number',
    'integer',
    'ratio',
    'angle',
    'url',
    'image',
    'position',
    'size',
    'bg-size',
    'line-width',
    'absolute-size',
    'relative-size',
    'family-name',
    'generic-name',
    'vector',
    'weight',
];

/** Values with no hint, which Tailwind infers a type for. */
const UNTYPED = [
    '2',
    'red-500',
    '[12px]',
    '[2]',
    '[var(--x)]',
    '[#f00]',
    '[linear-gradient(red,blue)]',
    // A colour with a math call is still the colour.
    '[rgb(calc(255)_0_0)]',
    // Relative colour syntax; its math spacing is TASK-13.61.
    '[oklch(from_var(--c)_calc(l)_c_h)]',
    '(--x)',
    // A slash on a bracket another property of the prefix reads.
    '[12px]/50',
    '[var(--x)]/50',
    // Three numbers: a vector on `rotate`, a colour or size elsewhere.
    '[1_0_0]',
];

/** Prefixes with a bracket form `dynamic()` reads outside the two tables. */
const OTHER_PREFIXES = [
    'opacity',
    'z',
    'rounded',
    'rounded-t',
    'rounded-tl',
    'rounded-s',
    'leading',
    'tracking',
    'font',
    'grid-cols',
    'grid-rows',
    'rotate',
    'duration',
    'delay',
];

/**
 * Every prefix `dynamic()` knows, with every untyped value and every hint, in
 * each form. A hint or the type Tailwind infers picks the property on a prefix
 * several share (`bg-(image:--x)`, `text-[12px]`) and is dropped on one a
 * single property owns; the longest prefix owns the class (`outline-offset-2`).
 * Whatever `dynamic()` writes, Tailwind writes; it may write no rule.
 */
const SWEEP = [...new Set([...Object.keys(COLOR_PROPS), ...Object.keys(SPACING_PROPS)])]
    .concat(OTHER_PREFIXES)
    .flatMap(prefix => [
        ...UNTYPED.map(value => `${prefix}-${value}`),
        ...HINTS.flatMap(hint => [
            `${prefix}-[${hint}:var(--x)]`,
            `${prefix}-[${hint}:12px]`,
            `${prefix}-(${hint}:--x)`,
        ]),
    ]);

/** Classes Tailwind writes no rule for, so `dynamic()` writes none either. */
const UNSERVED = ['bg-(--a:b)', 'w-(--a:b)', 'p-(length:b)'];

/**
 * @param declarations - `prop: value` pairs joined by `; `.
 * @returns Each pair.
 */
function pairs(declarations: string): string[] {
    return declarations
        .split(/;\s*/)
        .filter(Boolean)
        .map(pair => pair.trim());
}

/**
 * @param css - The CSS Tailwind writes for a class, or null for none.
 * @param pair - One `prop: value` pair `dynamic()` writes for it.
 * @returns Whether Tailwind writes that pair; a colour it writes inside the
 *   alpha's `color-mix()`.
 */
function writes(css: string | null | undefined, pair: string): boolean {
    const [property, value] = pair.split(/: (.*)/s) as [string, string];
    // `dynamic()` writes a shadow as the `box-shadow` itself, where Tailwind
    // composes it from `--tw-shadow` (TASK-13.63).
    const shadow = property === 'box-shadow' ? `--tw-shadow: ${value}` : pair;
    // Each starts a declaration, so `color: red;` is not found in `--tw-color: red;`.
    return [`${pair};`, `${shadow};`, `${property}: color-mix(in oklab, ${value} `].some(text =>
        [' ', '\n', '{', ';'].some(before => css?.includes(before + text)),
    );
}

/** What `dynamic()` writes unlike Tailwind, each with the task that fixes it. */
const KNOWN_UNLIKE: readonly string[] = [
    // TASK-13.63: a bracket shadow with no colour, which Tailwind gives the shadow colour.
    'shadow-[1_0_0] -> box-shadow: 1 0 0',
    // TASK-13.63: a ring with no offset and no `box-shadow`.
    'ring-2 -> --tw-ring-shadow: 0 0 0 2px var(--tw-ring-color, #3b82f680)',
];

describe('an arbitrary value written by dynamic(), as Tailwind writes it', async () => {
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: REPO,
    });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got: ${oracle.reason}`);

    it.each(SERVED)('%s', utility => {
        const [css] = oracle.cssFor([utility]);
        expect(css, utility).toBeTruthy();
        const written = pairs(generateDeclarations(utility));
        expect(written.length, utility).toBeGreaterThan(0);
        expect(
            written.filter(pair => !writes(css, pair)),
            css ?? '',
        ).toEqual([]);
    });

    it(`every prefix and value writes nothing Tailwind does not, over ${SWEEP.length} classes`, () => {
        const css = oracle.cssFor(SWEEP);
        const unlike = SWEEP.flatMap((utility, index) =>
            pairs(generateDeclarations(utility))
                .filter(pair => !writes(css[index], pair))
                .map(pair => `${utility} -> ${pair}`),
        );
        // Exact, so a fixed entry fails until it leaves the list.
        expect(unlike).toEqual(KNOWN_UNLIKE);
    });

    it.each(UNSERVED)('%s gets no rule', utility => {
        expect(oracle.cssFor([utility])).toEqual([null]);
        expect(generateDeclarations(utility)).toBe('');
    });
});
