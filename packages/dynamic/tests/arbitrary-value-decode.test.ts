/**
 * `decodeArbitraryValue`: Tailwind's reading of an arbitrary value's `_`.
 *
 * Every `_` is a space except inside `url()` and in the variable name a
 * `var()` or `theme()` starts with. The Tailwind-served cases live in
 * `tailwind-oracle/tests/dynamic-arbitrary-value.test.ts`; these pin the
 * shapes no class there reaches, and the properties the scan holds for any
 * input.
 */
import { describe, expect, it } from 'vitest';
import { decodeArbitraryValue } from '../src/css-generator.js';

describe('decodeArbitraryValue', () => {
    it.each([
        // A variable name keeps its `_`; its fallback does not.
        ['var(--a_b,_1px)', 'var(--a_b, 1px)'],
        ['theme(--spacing_x)', 'theme(--spacing_x)'],
        // A name read with the text before it still names the call.
        ['1px_+_var(--a_b)', '1px + var(--a_b)'],
        ['x_url(a_b)', 'x url(a_b)'],
        // A word ends at `/ : = < >` and a space too, so a call after one is named.
        ['1px/var(--a_b)', '1px/var(--a_b)'],
        ['a:url(x_y)', 'a:url(x_y)'],
        ['a=var(--b_c)>1', 'a=var(--b_c)>1'],
        ['x_y/z_w', 'x y/z w'],
        // `url()` is kept whole, nested calls included.
        ['url(a_(b)_c)_d', 'url(a_(b)_c) d'],
        ['var(--a_b,url(x_y))', 'var(--a_b,url(x_y))'],
        // A `var()` whose first part is a call keeps nothing.
        ['var(calc(a_b))', 'var(calc(a b))'],
        // Any other call is decoded throughout.
        ['calc(1px_+_2px)', 'calc(1px + 2px)'],
        ['rgb(0_0_0)', 'rgb(0 0 0)'],
        // Unbalanced input is written through, never thrown on.
        ['calc(1px_+_2px', 'calc(1px + 2px'],
        ['a_b)_c', 'a b) c'],
        ['var(--a_b', 'var(--a_b'],
        ['', ''],
    ])('%s reads as %s', (value, decoded) => {
        expect(decodeArbitraryValue(value)).toBe(decoded);
    });

    /**
     * A seeded generator, so a failure names an input that reproduces.
     *
     * @param seed - The seed.
     * @returns The next number in [0, 1).
     */
    function random(seed: number): () => number {
        let state = seed;
        return () => {
            state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
            return state / 2_147_483_648;
        };
    }
    const ALPHABET = 'abc12_-_(),%+.';

    it('is a plain `_` to space when no var, theme or url is named', () => {
        const next = random(20_261_126);
        for (let run = 0; run < 2000; run++) {
            const length = Math.floor(next() * 40);
            let value = '';
            for (let index = 0; index < length; index++) {
                value += ALPHABET[Math.floor(next() * ALPHABET.length)];
            }
            expect(decodeArbitraryValue(value), value).toBe(value.replaceAll('_', ' '));
        }
    });

    it('changes no character but an `_`, and keeps the length', () => {
        const next = random(7);
        const parts = ['var(', 'url(', 'theme(', 'calc(', ')', ',', '_', '--a', 'b', '1px'];
        for (let run = 0; run < 2000; run++) {
            let value = '';
            for (let index = 0; index < 12; index++) {
                value += parts[Math.floor(next() * parts.length)];
            }
            const decoded = decodeArbitraryValue(value);
            expect(decoded.length, value).toBe(value.length);
            expect(decoded.replaceAll(' ', '_'), value).toBe(value);
        }
    });

    it('reads a long value in one pass', () => {
        const value = `calc(${'var(--a_b)_+_'.repeat(20_000)}1px)`;
        const started = performance.now();
        const decoded = decodeArbitraryValue(value);
        expect(performance.now() - started).toBeLessThan(500);
        expect(decoded).toBe(`calc(${'var(--a_b) + '.repeat(20_000)}1px)`);
    });
});
