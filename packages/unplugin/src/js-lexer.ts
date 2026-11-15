/**
 * One forward pass over JavaScript or TypeScript text that tells code from
 * comments, strings, templates and regular expressions, without a parse.
 *
 * A scan that reads text for a construct (an import's specifier, a call's
 * callee) has to know whether it stands in code. Read backwards from a match,
 * that cannot be told: a `*` `/` may sit in a string, a regex or an
 * expression, and a line comment has no end to find from behind. So the text
 * is read forwards once, as Go's `go/build` reads a file's imports and as
 * `es-module-lexer` and TypeScript's `preProcessFile` do, and each literal is
 * handed over with the significant character before it.
 *
 * Cost: `n` is the text's length. Every index is visited once, a comment or a
 * literal is skipped by one search forward, and no token is allocated, so a
 * pass is `O(n)` time and `O(1)` memory. A text holding only comment ends or
 * only quotes is the worst case and stays linear.
 *
 * Domain: any text; the pass never throws. Where it reads without a parser it
 * errs as these lexers do, and each error heals within the line or the
 * literal:
 * - a `/` after `)` or `]` is division, so `if (x) /re/` reads as code;
 * - a template whose `${}` holds a backtick ends at that backtick;
 * - a quoted string ends at a line break, so a stray quote in JSX text
 *   (`<p>it's</p>`) is read as a string to the end of its line.
 *
 * @module
 */

/** What a literal is. */
export type JsLiteralKind = 'string' | 'template' | 'regex';

/** One literal, as the walk hands it over. The object is reused per call. */
export interface JsLiteral {
    /** What the literal is. */
    kind: JsLiteralKind;
    /** Index of its opening quote, backtick or slash. */
    start: number;
    /** Index after its closing character, or of the line break or text end it stopped at. */
    end: number;
    /** Index of the last character of code before it, past comments and whitespace; -1 at the start. */
    previous: number;
}

/** What a regular expression can follow: an operator or an opening bracket. */
const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^');

/** A keyword a regular expression can follow, at the end of the text before it. */
const REGEX_KEYWORD =
    /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|new|instanceof)$/;

/** The longest keyword in {@link REGEX_KEYWORD}, plus the character before it. */
const REGEX_KEYWORD_WINDOW = 11;

/**
 * Whether a `/` after the code character at `previous` opens a regular
 * expression rather than dividing.
 *
 * @param text - The text.
 * @param previous - Index of the code character before the slash, or -1.
 * @returns True when a regular expression can start there.
 */
function regexCanStart(text: string, previous: number): boolean {
    if (previous < 0 || REGEX_AFTER.has(text.charAt(previous))) return true;
    return (
        /[\w$]/.test(text.charAt(previous)) &&
        REGEX_KEYWORD.test(text.slice(Math.max(0, previous - REGEX_KEYWORD_WINDOW), previous + 1))
    );
}

/**
 * Where a quoted string or a template that opens at `start` ends.
 *
 * @param text - The text.
 * @param start - Index of the opening quote or backtick.
 * @returns Index after the closing character, or of the line break that ends
 *          a quoted string, or the text's length.
 */
function quotedEnd(text: string, start: number): number {
    const quote = text.charAt(start);
    for (let index = start + 1; index < text.length; index++) {
        const char = text.charAt(index);
        if (char === '\\') index++;
        else if (char === quote) return index + 1;
        else if (char === '\n' && quote !== '`') return index;
    }
    return text.length;
}

/**
 * Where a regular expression that opens at `start` ends: after its closing
 * slash, outside a character class, or at the line break or text end it
 * stops at. The flags after it are read as code.
 *
 * @param text - The text.
 * @param start - Index of the opening slash.
 * @returns The end index, exclusive.
 */
function regexEnd(text: string, start: number): number {
    let inClass = false;
    for (let index = start + 1; index < text.length; index++) {
        const char = text.charAt(index);
        if (char === '\\') index++;
        else if (char === '\n') return index;
        else if (char === '[') inClass = true;
        else if (char === ']') inClass = false;
        else if (char === '/' && !inClass) return index + 1;
    }
    return text.length;
}

/**
 * Whether a character is whitespace between tokens.
 *
 * @param char - One character.
 * @returns True for ASCII and Unicode whitespace and line terminators.
 */
function isSpace(char: string): boolean {
    return char <= ' ' || (char > '~' && /\s/.test(char));
}

/**
 * Where a comment that opens at `index` ends.
 *
 * @param text - The text.
 * @param index - Index to read from.
 * @returns The index of the line break after a line comment, the index after
 *          a block comment, the text's length for an unterminated one, or -1
 *          when no comment opens here.
 */
function commentEnd(text: string, index: number): number {
    // A hashbang (`#!/usr/bin/env node`) is a line comment at the very start.
    if (index === 0 && text.startsWith('#!')) {
        const close = text.indexOf('\n');
        return close === -1 ? text.length : close;
    }
    if (text.charAt(index) !== '/') return -1;
    const next = text.charAt(index + 1);
    if (next === '/') {
        const close = text.indexOf('\n', index + 2);
        return close === -1 ? text.length : close;
    }
    if (next !== '*') return -1;
    const close = text.indexOf('*/', index + 2);
    return close === -1 ? text.length : close + 2;
}

/** A line terminator, as ECMA-262 lists them. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * The first character of code at or after `from`, past whitespace and
 * comments, and whether a line terminator stands before it, so a reader can
 * tell where automatic semicolon insertion ends a statement. Costs the length
 * of the run it skips.
 *
 * @param text - The text.
 * @param from - Index to read from; 0 also skips a hashbang.
 * @returns The index of that character, or the text's length, and whether a
 *          line terminator came first.
 */
export function codeAfter(text: string, from: number): { index: number; lineBreak: boolean } {
    let index = from;
    let lineBreak = false;
    while (index < text.length) {
        const space = isSpace(text.charAt(index));
        const end = space ? index + 1 : commentEnd(text, index);
        if (end === -1) break;
        lineBreak ||= LINE_TERMINATOR.test(text.slice(index, end));
        index = end;
    }
    return { index, lineBreak };
}

/**
 * Read the literal that opens at `index`, if one does, into `literal.kind`.
 *
 * @param text - The text.
 * @param index - Index of a code character.
 * @param previous - Index of the code character before it, or -1.
 * @param literal - Receives the literal's kind.
 * @returns The literal's end, exclusive, or -1 when the character is code.
 */
function literalEnd(text: string, index: number, previous: number, literal: JsLiteral): number {
    const char = text.charAt(index);
    if (char === '"' || char === "'" || char === '`') {
        literal.kind = char === '`' ? 'template' : 'string';
        return quotedEnd(text, index);
    }
    if (char === '/' && regexCanStart(text, previous)) {
        literal.kind = 'regex';
        return regexEnd(text, index);
    }
    return -1;
}

/**
 * Hand each string, template and regular expression in `text` to `visit`, in
 * order, skipping comments. The walk stops when `visit` returns true.
 *
 * @param text - JavaScript or TypeScript source.
 * @param visit - Called with each literal; the object is reused, so copy what
 *        outlives the call.
 * @returns True when `visit` stopped the walk.
 */
export function walkJsLiterals(text: string, visit: (literal: JsLiteral) => boolean): boolean {
    const literal: JsLiteral = { kind: 'string', start: 0, end: 0, previous: -1 };
    let previous = -1;
    let index = 0;
    while (index < text.length) {
        if (isSpace(text.charAt(index))) {
            index += 1;
            continue;
        }
        const comment = commentEnd(text, index);
        if (comment !== -1) {
            index = comment;
            continue;
        }
        const end = literalEnd(text, index, previous, literal);
        if (end === -1) {
            previous = index;
            index += 1;
            continue;
        }
        literal.start = index;
        literal.end = end;
        literal.previous = previous;
        if (visit(literal)) return true;
        previous = end - 1;
        index = end;
    }
    return false;
}
