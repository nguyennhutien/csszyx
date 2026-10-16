/**
 * The markup reader the Vue and Svelte adapters share: what starts at a `<`,
 * where a `{ }` expression ends, and where a raw-text element ends.
 */
import { describe, expect, it } from 'vitest';

import {
    braceGroupEnd,
    isOpeningTag,
    markupResume,
    rawTextEnd,
    readMarkup,
} from '../src/markup-tags.js';

describe('readMarkup', () => {
    it.each([
        ['a start tag', '<a b="c">', { name: 'a', closing: false, selfClosing: false, end: 9 }],
        ['an end tag', '</a >', { name: 'a', closing: true, selfClosing: false, end: 5 }],
        ['a self-closing tag', '<a />', { name: 'a', closing: false, selfClosing: true, end: 5 }],
        [
            'a long name',
            '<svelte:head>',
            { name: 'svelte:head', closing: false, selfClosing: false, end: 13 },
        ],
        [
            'a > inside a quoted value',
            "<a b='>'>",
            { name: 'a', closing: false, selfClosing: false, end: 9 },
        ],
        [
            'a quote inside a name',
            "<a don't>",
            { name: 'a', closing: false, selfClosing: false, end: 9 },
        ],
        ['a comment', '<!-- <a> -->', { skip: 12 }],
        ['a bogus comment', '<!doctype html>', { skip: 15 }],
        ['a processing instruction', '<?xml?>', { skip: 7 }],
        ['text', '< a', 'text'],
        ['text after a character past z', '<{a}', 'text'],
        ['an end-tag look-alike', '</ a', 'text'],
    ])('reads %s', (_name, source, expected) => {
        expect(readMarkup(source, 0)).toEqual(expected);
    });

    it.each([
        ['a comment', '<!-- a'],
        ['a bogus comment', '<!a'],
        ['a quoted value', '<a b="c>'],
        ['a tag', '<a b'],
    ])('answers unclosed for %s', (_name, source) => {
        expect(readMarkup(source, 0)).toBe('unclosed');
    });

    it('ends a tag at a > inside braces unless expressions are on', () => {
        const source = '<a b={c > d}>';
        expect(readMarkup(source, 0)).toMatchObject({ end: 9 });
        expect(readMarkup(source, 0, { expressions: true })).toMatchObject({ end: 13 });
    });

    it.each([
        ['an attribute value', "<a b={'>'} c>", 13],
        ['a spread', '<a {...{ b: 1 }}>', 17],
        ['a shorthand', '<a {b}/>', 8],
    ])('reads a whole expression in %s', (_name, source, end) => {
        expect(readMarkup(source, 0, { expressions: true })).toMatchObject({ end });
    });

    it('answers unclosed for an expression in a tag that never closes', () => {
        expect(readMarkup('<a b={c>', 0, { expressions: true })).toBe('unclosed');
    });
});

describe('markupResume and isOpeningTag', () => {
    it('resumes after text, a skipped span and a tag', () => {
        expect(markupResume('text', 4)).toBe(5);
        expect(markupResume({ skip: 9 }, 0)).toBe(9);
        expect(markupResume({ name: 'a', closing: false, selfClosing: false, end: 3 }, 0)).toBe(3);
    });

    it.each([
        ['a start tag', { name: 'a', closing: false, selfClosing: false, end: 3 }, true],
        ['an end tag', { name: 'a', closing: true, selfClosing: false, end: 4 }, false],
        ['a self-closing tag', { name: 'a', closing: false, selfClosing: true, end: 5 }, false],
        ['a skipped span', { skip: 3 }, false],
        ['text', 'text' as const, false],
    ])('tells whether %s opens an element', (_name, markup, expected) => {
        expect(isOpeningTag(markup)).toBe(expected);
    });
});

describe('braceGroupEnd', () => {
    it.each([
        ['a flat group', '{a}', 2],
        ['nested braces', '{a({ b: { c } })}', 16],
        ['a brace in a string', "{'}'}", 4],
        ['an escaped quote', "{'\\'}'}", 6],
        ['a brace in a template literal', '{`}${a}`}', 8],
        ['a double-quoted string', '{"}"}', 4],
        ['a quote in a regex', "{s.replace(/'/g, '')}", 20],
        ['a brace in a regex', "{s.replace(/}/g, '')}", 20],
        ['a slash in a regex class', "{a && /[/'}]/.test(s)}", 21],
        ['an escaped slash in a regex', "{a && /\\/'/.test(s)}", 19],
        ['a regex after a keyword', "{() => { return /'/ }}", 21],
        ['a quote in a block comment', "{x /* don't } */}", 16],
        ['a quote in a line comment', "{x // don't }\n}", 14],
        ['a division, not a regex', '{a / b / c}', 10],
        ['a division after a call', "{f(a) / 2 + g('}')}", 18],
        ['a division after an index', "{a[0] / b['}']}", 14],
        ['a quote in a nested template substitution', "{`${a ? `'` : '}'}`}", 19],
        ['a regex in a template substitution', "{`${/'/.source}`}", 16],
        ['an escaped backtick in a template literal', '{`a\\`}`}', 7],
    ])('ends %s at its matching brace', (_name, source, end) => {
        expect(braceGroupEnd(source, 0)).toBe(end);
    });

    it.each([
        ['a block end', '{/if}', 4],
        ['an each end', '{/each}', 6],
        ['a block open with a regex', "{#if /'/.test(s)}", 16],
        ['an else-if with a division', '{:else if a / b}', 15],
        ['a text expression opening with a comment', "{/* don't */ a}", 14],
        ['a text expression opening with a line comment', "{// don't\n a}", 12],
    ])('ends Svelte %s at its brace, not a regex', (_name, source, end) => {
        expect(braceGroupEnd(source, 0)).toBe(end);
    });

    it.each([
        ['a group', '{a'],
        ['a nested group', '{{a}'],
        ['a string', "{'a}"],
        ['a block comment', '{a /* }'],
        ['a template literal', '{`a}'],
        ['a template substitution', '{`${a}'],
        ['a regex', '{x = /a}'],
        ['a regex broken by a line', '{x = /a\n/}'],
        ['a line comment', '{a // }'],
    ])('answers -1 when %s never closes', (_name, source) => {
        expect(braceGroupEnd(source, 0)).toBe(-1);
    });

    it('reads braces nested 100k deep in linear time', () => {
        const source = `${'{'.repeat(100_000)}${'}'.repeat(100_000)}`;
        const startedAt = performance.now();
        expect(braceGroupEnd(source, 0)).toBe(source.length - 1);
        expect(braceGroupEnd(source.slice(0, -1), 0)).toBe(-1);
        expect(performance.now() - startedAt).toBeLessThan(2_000);
    });
});

describe('rawTextEnd', () => {
    it('ends past its own end tag, not a longer name', () => {
        const source = '<script>a</scripts>b</script >c';
        expect(rawTextEnd(source, 'script', 8)).toBe(source.length - 1);
    });

    it.each([
        ['there is no end tag', '<script>a'],
        ['only longer names close', '<script>a</scripts>'],
        ['the end tag never closes', '<script>a</script b="'],
    ])('answers -1 when %s', (_name, source) => {
        expect(rawTextEnd(source, 'script', 8)).toBe(-1);
    });

    it('scans 100k look-alike end tags in linear time', () => {
        const source = `<script>${'</scriptx'.repeat(100_000)}`;
        const startedAt = performance.now();
        expect(rawTextEnd(source, 'script', 8)).toBe(-1);
        expect(performance.now() - startedAt).toBeLessThan(2_000);
    });
});

/**
 * Differential check: random expressions built from the tokens that hide a
 * brace or a quote (strings, template literals and their substitutions,
 * comments, regular expressions, divisions), each one valid JavaScript by
 * `oxc-parser`, must end at the brace that wraps them.
 */
describe('braceGroupEnd on generated expressions', () => {
    const TOKENS = [
        "'}'",
        '"{"',
        "'\\''",
        '`}`',
        "/'}/g",
        "/[/'}]/",
        "/* } ' */ 1",
        'x / 2',
        'f(1) / 2',
        '[2][0] / 2',
        "1 // } '\n",
        "f(') ')",
        '[1, "}"][0]',
        'a ? b : c',
    ];

    /**
     * A deterministic pseudo-random sequence.
     *
     * @param seed - Seed.
     * @returns The next value in [0, 1).
     */
    function random(seed: number): () => number {
        let state = seed;
        return () => {
            state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
            return state / 2_147_483_648;
        };
    }

    /**
     * An expression `depth` levels deep.
     *
     * @param next - Random source.
     * @param depth - Nesting left.
     * @returns The expression.
     */
    function expression(next: () => number, depth: number): string {
        const pick = Math.floor(next() * (TOKENS.length + 4));
        if (depth === 0 || pick < TOKENS.length) return TOKENS[pick % TOKENS.length];
        const inner = expression(next, depth - 1);
        const right = expression(next, depth - 1);
        return [
            `({ k: ${inner} })`,
            `\`\${${inner}}'\${${right}}\``,
            `[${inner}, ${right}]`,
            `(() => { return ${inner} })()`,
        ][pick - TOKENS.length];
    }

    it('ends 500 generated expressions at their wrapping brace', async () => {
        const { parseSync } = await import('oxc-parser');
        const next = random(20_261_016);
        for (let run = 0; run < 500; run += 1) {
            // `v + ` first: Svelte reads `{/` as a block end, so no body opens with a regex.
            const body = `v + ${expression(next, 4)} + ${expression(next, 3)}`;
            expect(parseSync('x.js', `(${body}\n)`).errors).toEqual([]);
            const source = `{${body}\n}`;
            expect(braceGroupEnd(source, 0), source).toBe(source.length - 1);
        }
    });
});
