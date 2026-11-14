/**
 * The shared forward lexer: which spans are literals, and the code character
 * each one follows, past comments and whitespace.
 */
import { describe, expect, it } from 'vitest';

import { type JsLiteral, walkJsLiterals } from '../src/js-lexer.js';

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
            'template:`b${c}`@,',
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

    it('ends at the text end inside an unterminated comment or literal', () => {
        expect(literals("'a")).toEqual(["string:'a@^"]);
        expect(literals('x = /re')).toEqual(['regex:/re@=']);
        expect(literals("/* 'a'")).toEqual([]);
        expect(literals("// 'a'")).toEqual([]);
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
        expect(literals("import　'a'")).toEqual(["string:'a'@t"]);
    });
});
