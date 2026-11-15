/**
 * The directive prologue of a module: the string statements that open it,
 * such as `'use client'`, read without a parser. One reader serves the RSC
 * boundary check, which asks which directives a module has, and the import
 * injection, which must put an import after them.
 *
 * The module is read by the shared lexer, which skips comments the way every
 * other scan here does. A string is a directive when it opens the module or
 * follows the previous directive, and its statement ends right after it, as
 * ECMA-262 ends one: at a semicolon, at the module's end, or at a line break
 * the next token cannot continue (automatic semicolon insertion), so
 * `'use client' + x` and `'use client'\n(a)` are expressions, not directives.
 *
 * Cost: `n` is the module's length; the read stops at the first literal that
 * is not a directive, so it is `O(n)` and in practice the length of the
 * prologue and the statement after it.
 *
 * @module
 */

import { codeAfter, walkJsLiterals } from './js-lexer.js';

/** A `'use client'` or `'use server'` directive, as the reader returns it. */
const USE_DIRECTIVE_RE = /^['"]use (?:client|server)['"]/;

/** One statement of the prologue, and the offset after it. */
export interface DirectiveStatement {
    /** The directive's quoted text, and `;` when a semicolon ends it. */
    readonly statement: string;
    /** Offset after the directive's closing quote, or after its semicolon. */
    readonly end: number;
}

/**
 * Text that continues an expression across a line break, so no semicolon is
 * inserted before it: an operator, a bracket, a template, `in` or
 * `instanceof`. `++` and `--` are not among them: a line break before either
 * ends the statement.
 */
const CONTINUES = /^(?:[-+](?![-+])|[*/%.,?=<>&|^([`]|!=|in(?:stanceof)?(?![\w$]))/;

/**
 * Where the directive statement whose literal ends at `end` ends, or -1 when
 * the literal is not a statement of its own.
 *
 * @param code Module source.
 * @param end Offset after the closing quote.
 * @returns Offset after the directive's semicolon when one ends it, `end`
 *          when the module's end or a line break does, or -1.
 */
function directiveEnd(code: string, end: number): number {
    const { index, lineBreak } = codeAfter(code, end);
    if (code.charAt(index) === ';') return index + 1;
    if (index === code.length) return end;
    return lineBreak && !CONTINUES.test(code.slice(index, index + 11)) ? end : -1;
}

/**
 * Whether the quoted string the lexer read over `start`..`end` closed with its
 * quote, rather than stopping at a line break or the end of the module.
 *
 * @param code Module source.
 * @param start Offset of the opening quote.
 * @param end Offset the lexer gave as the string's end.
 * @returns True when the last character is the quote and no backslash escapes it.
 */
function isClosed(code: string, start: number, end: number): boolean {
    if (end - start < 2 || code.charAt(end - 1) !== code.charAt(start)) return false;
    let backslashes = 0;
    while (code.charAt(end - 2 - backslashes) === '\\' && end - 2 - backslashes > start) {
        backslashes++;
    }
    return backslashes % 2 === 0;
}

/**
 * Reads the top-level directive prologue without requiring a full parser.
 *
 * @param code module source
 * @returns each directive statement, in order, with the offset after it
 */
export function readDirectivePrologue(code: string): DirectiveStatement[] {
    const out: DirectiveStatement[] = [];
    // The last code character of the prologue so far: -1 before the first
    // directive, then a directive's closing quote or its semicolon.
    let last = -1;
    walkJsLiterals(code, ({ kind, start, end, previous }) => {
        if (kind !== 'string' || previous !== last || !isClosed(code, start, end)) return true;
        const statementEnd = directiveEnd(code, end);
        if (statementEnd === -1) return true;
        const semicolon = statementEnd !== end;
        out.push({ statement: code.slice(start, end) + (semicolon ? ';' : ''), end: statementEnd });
        last = statementEnd - 1;
        return false;
    });
    return out;
}

/**
 * Inserts generated code after a module's last `'use client'` or
 * `'use server'` directive, wherever it stands in the prologue, and the
 * whitespace that follows it; first in the module when it has none, after
 * a hashbang line. Not
 * after another directive alone: a module is strict anyway. A directive that
 * no semicolon ends gets a line break before the insertion, so the insertion
 * starts a statement of its own.
 *
 * @param code Module source.
 * @param insertion Code to insert.
 * @returns Source with the insertion placed after the directive when present.
 */
export function insertAfterUseDirective(code: string, insertion: string): string {
    let offset = -1;
    let ended = false;
    for (const { statement, end } of readDirectivePrologue(code)) {
        if (USE_DIRECTIVE_RE.test(statement)) {
            offset = end;
            ended = statement.endsWith(';');
        }
    }
    if (offset === -1) {
        // A hashbang must stay the module's first line.
        if (!code.startsWith('#!')) return `${insertion}${code}`;
        const lineEnd = code.indexOf('\n');
        if (lineEnd === -1) return `${code}\n${insertion}`;
        return `${code.slice(0, lineEnd + 1)}${insertion}${code.slice(lineEnd + 1)}`;
    }

    const from = offset;
    while (offset < code.length && /\s/.test(code.charAt(offset))) offset++;
    const separator = ended || /[\n\r\u2028\u2029]/.test(code.slice(from, offset)) ? '' : '\n';
    return `${code.slice(0, offset)}${separator}${insertion}${code.slice(offset)}`;
}
