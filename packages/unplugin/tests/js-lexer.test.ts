/**
 * The shared forward lexer: which spans are literals, and the code character
 * each one follows, past comments and whitespace.
 */
import { describe, expect, it } from 'vitest';
import { cpuMsPerCall } from '../../core/tests/helpers/cpu-time.js';
import {
    codeAfter,
    type JsLiteral,
    maskJsComments,
    stripJsCommentsAndLiterals,
    walkJsLiterals,
    walkJsTokens,
} from '../src/js-lexer.js';

/**
 * Every literal in `text`, as `kind:text@previous-char`.
 *
 * @param text - Module text.
 * @returns One entry per literal.
 */
function literals(text: string): string[] {
    const seen: string[] = [];
    walkJsLiterals(text, (literal: JsLiteral) => {
        const before = literal.previous < 0 ? '^' : text.charAt(literal.previous);
        seen.push(`${literal.kind}:${text.slice(literal.start, literal.end)}@${before}`);
        return false;
    });
    return seen;
}

describe('walkJsLiterals', () => {
    it('hands over strings, templates and regexes with the code before them', () => {
        expect(literals("f('a', `b${c}`) /* 'no' */ // 'no'\nx = /[/']+/g;")).toEqual([
            "string:'a'@(",
            'template:`b${@,',
            'template:}`@c',
            "regex:/[/']+/@=",
        ]);
    });

    it('reads a slash after a value as division and after a keyword as a regex', () => {
        expect(literals("a = b / c / 'd'")).toEqual(["string:'d'@/"]);
        expect(literals("return /'/.test(x) ? 'y' : 0")).toEqual(["regex:/'/@n", "string:'y'@?"]);
        expect(literals("x = typeof /'/")).toEqual(["regex:/'/@f"]);
        expect(literals("/'/.test(s)")).toEqual(["regex:/'/@^"]);
        // An escaped slash does not end the regex.
        expect(literals("x = /a\\/'/; 'b'")).toEqual(["regex:/a\\/'/@=", "string:'b'@;"]);
    });

    it('stops a quoted string at a line break and a template only at its backtick', () => {
        expect(literals("<p>it's</p>\n'x'")).toEqual(["string:'s</p>@t", "string:'x'@>"]);
        expect(literals('`a\nb` "c\\"d"')).toEqual(['template:`a\nb`@^', 'string:"c\\"d"@`']);
    });

    it('ends at the text end inside an unterminated literal or line comment', () => {
        expect(literals("'a")).toEqual(["string:'a@^"]);
        expect(literals('x = /re')).toEqual(['regex:/re@=']);
        expect(literals("// 'a'")).toEqual([]);
    });

    it('reads a `/*` that never closes as code, which only JSX text holds', () => {
        // A module with an unclosed block comment does not parse, so the
        // opener stands in JSX text, and the code after its line is read.
        expect(literals("<p>Use /* here</p>\nimport('./a')")).toEqual([
            'regex:/p>@<',
            "string:'./a'@(",
        ]);
        expect(literals("x = 1 /* 'a'")).toEqual(["string:'a'@*"]);
    });

    it('reads a slash after a postfix `++` or `--` as division', () => {
        expect(literals("n = i++ / 2; 'b'")).toEqual(["string:'b'@;"]);
        expect(literals("n = i-- / 2; 'b'")).toEqual(["string:'b'@;"]);
        // After a binary `+` it still opens a regex.
        expect(literals("s = a + /'/.source")).toEqual(["regex:/'/@+"]);
    });

    it('ends a line comment, a string and a regex at any line terminator', () => {
        expect(literals("// a\r'b'")).toEqual(["string:'b'@^"]);
        expect(literals("// a\u2028'b'")).toEqual(["string:'b'@^"]);
        expect(literals("#!node\r'a'")).toEqual(["string:'a'@^"]);
        expect(literals("'a\r'b'")).toEqual(["string:'a@^", "string:'b'@a"]);
        expect(literals("x = /a\u2029'b'")).toEqual(['regex:/a@=', "string:'b'@a"]);
        // A string may hold U+2028 and U+2029, and a backslash continues it
        // over CRLF.
        expect(literals("'a\u2028b' 'c'")).toEqual(["string:'a\u2028b'@^", "string:'c'@'"]);
        expect(literals("'a\\\r\nb' 'c'")).toEqual(["string:'a\\\r\nb'@^", "string:'c'@'"]);
    });

    it('stops the walk when the visitor says so', () => {
        const seen: string[] = [];
        const stopped = walkJsLiterals("'a' 'b'", literal => {
            seen.push(literal.kind);
            return true;
        });
        expect(stopped).toBe(true);
        expect(seen).toEqual(['string']);
        expect(walkJsLiterals("'a'", () => false)).toBe(false);
    });

    it('reads Unicode whitespace as space', () => {
        expect(literals("import\u3000'a'")).toEqual(["string:'a'@t"]);
    });

    it('reads a hashbang as a comment, only at the very start', () => {
        expect(literals("#!/usr/bin/env node\n'a'")).toEqual(["string:'a'@^"]);
        expect(literals("#!/usr/bin/env 'node'")).toEqual([]);
        expect(literals("x\n#!/'a'")).toEqual(["regex:/'a'@!"]);
    });
});

describe('codeAfter', () => {
    it.each([
        ['x', 0, 0, false],
        ['  ;', 0, 2, false],
        ['/* a */ /* b */;', 0, 15, false],
        ['/* a\n */;', 0, 8, true],
        ['// a\n;', 0, 5, true],
        ['\u2028;', 0, 1, true],
        ['\r;', 0, 1, true],
        ['#!/bin/node\n;', 0, 12, true],
        ['a #!b', 1, 2, false],
        // A `/*` that never closes is code.
        ['  /* open', 0, 2, false],
        ['   ', 1, 3, false],
    ])('reads %j from %i to %i, line break %s', (text, from, index, lineBreak) => {
        expect(codeAfter(text, from)).toEqual({ index, lineBreak });
    });
});

/**
 * Every token in `text`, comments included, as `kind:text@previous-char`.
 *
 * @param text - Module text.
 * @returns One entry per token.
 */
function tokens(text: string): string[] {
    const seen: string[] = [];
    walkJsTokens(text, token => {
        const before = token.previous < 0 ? '^' : text.charAt(token.previous);
        seen.push(`${token.kind}:${text.slice(token.start, token.end)}@${before}`);
        return false;
    });
    return seen;
}

describe('walkJsTokens', () => {
    it('hands over comments too, which leave the code before the next token as it was', () => {
        expect(tokens("f(/* a */ 'b') // c\n'd'")).toEqual([
            'comment:/* a */@(',
            "string:'b'@(",
            'comment:// c@)',
            "string:'d'@)",
        ]);
    });

    it('lexes the code in a placeholder, templates and braces nested', () => {
        expect(tokens("`a${ f('x', `/*${y}*/`) }b` /* c */")).toEqual([
            'template:`a${@^',
            "string:'x'@(",
            'template:`/*${@,',
            'template:}*/`@y',
            'template:}b`@)',
            'comment:/* c */@`',
        ]);
        expect(tokens("`${ {a: '}'}.a }x` 'y'")).toEqual([
            'template:`${@^',
            "string:'}'@:",
            'template:}x`@a',
            "string:'y'@`",
        ]);
        // A `}` with no placeholder open is code.
        expect(tokens("} 'a'")).toEqual(["string:'a'@}"]);
        // An escaped backtick or `\${` neither ends the template nor opens a placeholder.
        expect(tokens("`a\\`b\\${c}` 'd'")).toEqual(['template:`a\\`b\\${c}`@^', "string:'d'@`"]);
    });

    it('stops the walk when the visitor says so', () => {
        expect(walkJsTokens('/* a */ /* b */', () => true)).toBe(true);
    });

    it('reads a hashbang as a comment, and `#!` elsewhere as code', () => {
        expect(tokens("#!/usr/bin/env node\n'a'")).toEqual([
            'comment:#!/usr/bin/env node@^',
            "string:'a'@^",
        ]);
        expect(tokens('#!node')).toEqual(['comment:#!node@^']);
        expect(tokens("x #! 'a'")).toEqual(["string:'a'@!"]);
    });
});

describe('walkJsTokens cost', () => {
    /**
     * How much longer the walk over `large` takes than the walk over `small`.
     * The two are walked in turn, after one walk of each to warm the JIT, and
     * each keeps its fastest CPU time per walk (`cpuMsPerCall`), so a stretch of load on the
     * machine slows both sides instead of one, and time other processes hold
     * the CPU is not counted.
     *
     * @param small - Module text.
     * @param large - The same shape, longer.
     * @returns The ratio of the fastest walks.
     */
    function growth(small: string, large: string): number {
        const best = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
        for (let run = 0; run < 5; run++) {
            [small, large].forEach((text, side) => {
                const ms = cpuMsPerCall(() => walkJsTokens(text, () => false));
                if (run > 0) best[side] = Math.min(best[side], ms);
            });
        }
        return best[1] / best[0];
    }

    // Each worst case is one shape the walk keeps state for, walked at 250 KB
    // and at four times that. A linear walk takes about four times as long, a
    // quadratic one sixteen; the bound sits between them. The shape is its own
    // control: set against plain code instead, the cost a shape has per byte
    // read as growth, and a loaded runner pushed it past the bound.
    const fill = (unit: string, size: number): string => unit.repeat(Math.ceil(size / unit.length));

    it.each<[string, (size: number) => string]>([
        ['placeholders opened and never closed', size => fill('`${', size)],
        ['placeholders nested in templates', size => `${fill('`a${', size)}${fill('}b`', size)}`],
        ['closing braces with no placeholder open', size => fill('}', size)],
        ['comment openers that never close', size => `/*${fill('a/*', size)}`],
        ['quotes that never close', size => fill("'a\n", size)],
        ['slashes after keywords', size => fill('return / x ', size)],
    ])('walks %s in linear time', (_case, shape) => {
        expect(growth(shape(250_000), shape(1_000_000))).toBeLessThan(8);
    });
});

describe('maskJsComments', () => {
    it('blanks every comment and keeps offsets and line breaks', () => {
        const code = "a /* x\ny */ b // z\n'/* s */' `${/* t */1}`";
        const masked = maskJsComments(code);
        expect(masked).toBe("a     \n     b     \n'/* s */' `${       1}`");
        expect(masked).toHaveLength(code.length);
        expect(maskJsComments('no comments')).toBe('no comments');
        // A hashbang holds no code, and stays as written.
        expect(maskJsComments('#!/usr/bin/env node\n// x')).toBe('#!/usr/bin/env node\n    ');
        // A `/*` in JSX text that never closes leaves the code after it.
        const jsx = "<p>Use /* here</p>;\nexport { a } from './a';";
        expect(maskJsComments(jsx)).toBe(jsx);
        // Text that holds no JSX reads it as a comment to the end, as a parser does.
        expect(maskJsComments('a /* b\n c', { jsx: false })).toBe('a     \n  ');
        expect(maskJsComments('a /* b */ c /* d', { jsx: false })).toBe('a         c     ');
    });
});

describe('stripJsCommentsAndLiterals', () => {
    // Each case is a module the scanner it replaced read wrong (measured on
    // the repository against TypeScript's parser): the fail-closed guard of
    // the Next transform matches `sz=` / `sz: {` in this text.
    it.each([
        [
            'a hashbang, whose slashes read as a regex',
            '#!/usr/bin/env node\nconst fixture = "<div sz={{ p: 4 }} />";',
            'const fixture = ;',
        ],
        [
            'a template inside a placeholder',
            "const s = `${JSON.stringify(`x`)}`; const schema = { sz: { type: 'object' } };",
            'const s = JSON.stringify(); const schema = { sz: { type: } };',
        ],
        [
            'a template whose text spells a prop',
            "const t = `sz={{ p: ${padding}, bg: '${palette}-500' }}`;",
            'const t = paddingpalette;',
        ],
    ])('reads %s', (_case, code, out) => {
        expect(stripJsCommentsAndLiterals(code).replaceAll(/\s+/g, ' ').trim()).toBe(out);
    });

    it('keeps only code: placeholders stay, their template text goes', () => {
        expect(stripJsCommentsAndLiterals("x = 'sz={{}}'; /* sz= */ `a${ sz }b` + /sz=/;")).toBe(
            'x = ;   sz  + ;',
        );
    });
});
