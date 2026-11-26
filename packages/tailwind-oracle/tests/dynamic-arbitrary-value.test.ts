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

import { generateDeclarations } from '../../dynamic/src/css-generator.js';
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
 * Classes whose hint names another property of a shared prefix than the one
 * `dynamic()` writes for it: it writes no rule rather than the wrong one, so
 * anything it does write is what Tailwind writes.
 */
const OTHER_PROPERTY = [
    'bg-(image:--x)',
    'bg-(length:--x)',
    'bg-(size:--x)',
    'bg-(position:--x)',
    'bg-(url:--x)',
    'bg-[length:var(--x)]',
    'bg-[position:var(--x)]',
    'border-(length:--x)',
    'border-(line-width:--x)',
    'outline-(length:--x)',
    'decoration-(length:--x)',
    'stroke-(length:--x)',
    'stroke-(number:--x)',
    'ring-(length:--x)',
    'ring-offset-(length:--x)',
    'text-(length:--x)',
];

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
        // A colour utility writes its colour inside the alpha's `color-mix()`.
        const missing = written.filter(pair => {
            const [property, value] = pair.split(/: (.*)/s) as [string, string];
            return ![`${pair};`, `${property}: color-mix(in oklab, ${value} `].some(text =>
                css?.includes(text),
            );
        });
        expect(missing, css ?? '').toEqual([]);
    });

    it.each(OTHER_PROPERTY)('%s writes no other property than Tailwind does', utility => {
        const [css] = oracle.cssFor([utility]);
        expect(css, utility).toBeTruthy();
        const wrong = pairs(generateDeclarations(utility)).filter(
            pair => !css?.includes(`${pair};`),
        );
        expect(wrong, css ?? '').toEqual([]);
    });

    it.each(UNSERVED)('%s gets no rule', utility => {
        expect(oracle.cssFor([utility])).toEqual([null]);
        expect(generateDeclarations(utility)).toBe('');
    });
});
