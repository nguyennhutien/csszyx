/**
 * One forward pass over JavaScript or TypeScript text that tells code from
 * comments, strings, templates and regular expressions, without a parse.
 *
 * A scan that reads text for a construct (an import's specifier, a call's
 * callee, a prop) has to know whether it stands in code. Read backwards from
 * a match, that cannot be told: a `*` `/` may sit in a string, a regex or an
 * expression, and a line comment has no end to find from behind. So the text
 * is read forwards once, as Go's `go/build` reads a file's imports and as
 * `es-module-lexer` and TypeScript's `preProcessFile` do: each token is
 * handed over with the code character before it, comments leave that
 * character as it was, and a template's `${}` is lexed as code on a stack of
 * brace depths, so templates nest.
 *
 * Cost: `n` is the text's length. Every index is visited once, a comment or a
 * literal is skipped by one search forward, and no token is allocated (one
 * object is reused; the stack holds one entry per open placeholder), so a
 * pass is `O(n)` time. A text holding only comment ends, quotes or `${` is
 * the worst case and stays linear.
 *
 * Domain: any text; the pass never throws. Where it reads without a parser it
 * errs as these lexers do, and each error heals within the line or the
 * literal:
 * - a `/` after `)` or `]` is division, so `if (x) /re/` reads as code;
 * - JSX text is read as code, so `<p>http://x</p>` opens a line comment and a
 *   stray quote (`<p>it's</p>`) a string, each to the end of its line.
 *
 * One error does not heal: a `/*` in JSX text (`<p>src/**.ts</p>`) opens a
 * block comment that runs to the next `*\/` in the file, so the code up to a
 * later real comment's close reads as comment. A `/*` that never closes is
 * read as code, since only JSX text can hold one in a module that parses; a
 * reader of text that holds no JSX can read it as a comment to the end
 * ({@link JsLexOptions}).
 *
 * @module
 */

/** What a literal is. A template is handed over one piece at a time. */
export type JsLiteralKind = 'string' | 'template' | 'regex';

/** What a token is: a literal, or a comment. */
export type JsTokenKind = JsLiteralKind | 'comment';

/** One token, as the walk hands it over. The object is reused per call. */
export interface JsToken {
    /** What the token is. */
    kind: JsTokenKind;
    /**
     * Index of its opening quote, slash or backtick; for a template piece
     * after a placeholder, the `}` that closes it.
     */
    start: number;
    /**
     * Index after its closing character (a template piece that opens a
     * placeholder ends after its `${`), or of the line break or text end it
     * stopped at.
     */
    end: number;
    /** Index of the last character of code before it, past comments and whitespace; -1 at the start. */
    previous: number;
}

/** One literal, as {@link walkJsLiterals} hands it over. */
export interface JsLiteral extends JsToken {
    /** What the literal is. */
    kind: JsLiteralKind;
}

/** How a walk reads its text. */
export interface JsLexOptions {
    /**
     * Whether the text can hold JSX (the default). When it cannot, a `/*`
     * that never closes is a comment to the end of the text, as a parser
     * reads it; when it can, the opener stands in JSX text and is code.
     */
    jsx?: boolean;
}

/** The brace depths a walk tracks, so a `}` that closes a placeholder resumes its template. */
interface BraceState {
    /** Open `{` and `${` in code. */
    depth: number;
    /** For each open placeholder, the depth outside it. */
    resume: number[];
}

/** A line terminator, as ECMA-262 lists them. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/** The same, searched for from `lastIndex`. */
const NEXT_LINE_TERMINATOR = /[\n\r\u2028\u2029]/g;

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
    if (previous < 0) return true;
    const char = text.charAt(previous);
    // A postfix `++` or `--` ends an operand; no regex follows one.
    if ((char === '+' || char === '-') && text.charAt(previous - 1) === char) return false;
    if (REGEX_AFTER.has(char)) return true;
    return (
        /[\w$]/.test(text.charAt(previous)) &&
        REGEX_KEYWORD.test(text.slice(Math.max(0, previous - REGEX_KEYWORD_WINDOW), previous + 1))
    );
}

/**
 * Where a quoted string that opens at `start` ends.
 *
 * @param text - The text.
 * @param start - Index of the opening quote.
 * @returns Index after the closing quote, or of the line break that ends the
 *          string, or the text's length.
 */
function quotedEnd(text: string, start: number): number {
    const quote = text.charAt(start);
    for (let index = start + 1; index < text.length; index++) {
        const char = text.charAt(index);
        if (char === '\\') index += text.startsWith('\r\n', index + 1) ? 2 : 1;
        else if (char === quote) return index + 1;
        // A string may hold U+2028 and U+2029, not a line feed or a carriage return.
        else if (char === '\n' || char === '\r') return index;
    }
    return text.length;
}

/**
 * Where a template piece that opens at `start` ends: after its closing
 * backtick, after the `${` of a placeholder, or at the text's end.
 *
 * @param text - The text.
 * @param start - Index of the backtick, or of the `}` closing a placeholder.
 * @returns The end index, exclusive.
 */
function templateEnd(text: string, start: number): number {
    for (let index = start + 1; index < text.length; index++) {
        const char = text.charAt(index);
        if (char === '\\') index++;
        else if (char === '`') return index + 1;
        else if (char === '$' && text.charAt(index + 1) === '{') return index + 2;
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
        else if (char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029') {
            return index;
        } else if (char === '[') inClass = true;
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
 * Index of the first line terminator at or after `from`.
 *
 * @param text - The text.
 * @param from - Index to search from.
 * @returns That index, or the text's length.
 */
function lineEnd(text: string, from: number): number {
    NEXT_LINE_TERMINATOR.lastIndex = from;
    return NEXT_LINE_TERMINATOR.exec(text)?.index ?? text.length;
}

/**
 * Where a block comment can still close: from the index a search for `*\/`
 * found none after, no opener closes. Kept per walk, so openers that never
 * close cost one search, not one each.
 */
interface BlockCloseState {
    /** The first index after which the text holds no `*\/`. */
    noneFrom: number;
    /** Whether a `/*` that never closes is a comment to the end. */
    unclosedIsComment: boolean;
}

/**
 * The block-comment state a walk starts with.
 *
 * @param text - The text.
 * @param options - How the walk reads it.
 * @returns A fresh state.
 */
function blockCloseState(text: string, options: JsLexOptions): BlockCloseState {
    return { noneFrom: text.length, unclosedIsComment: options.jsx === false };
}

/**
 * Where a comment that opens at `index` ends.
 *
 * @param text - The text.
 * @param index - Index to read from.
 * @param blocks - What earlier searches for `*\/` found.
 * @returns The index of the line terminator after a line comment, the index
 *          after a block comment, or -1 when no comment opens here; a `/*`
 *          that never closes runs to the text's length, or opens none when
 *          the text can hold JSX.
 */
function commentEnd(text: string, index: number, blocks: BlockCloseState): number {
    // A hashbang (`#!/usr/bin/env node`) is a line comment at the very start.
    if (index === 0 && text.startsWith('#!')) return lineEnd(text, 2);
    if (text.charAt(index) !== '/') return -1;
    const next = text.charAt(index + 1);
    if (next === '/') return lineEnd(text, index + 2);
    if (next !== '*') return -1;
    const close = index < blocks.noneFrom ? text.indexOf('*/', index + 2) : -1;
    if (close !== -1) return close + 2;
    blocks.noneFrom = Math.min(blocks.noneFrom, index);
    return blocks.unclosedIsComment ? text.length : -1;
}

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
    const blocks = blockCloseState(text, {});
    let index = from;
    let lineBreak = false;
    while (index < text.length) {
        const space = isSpace(text.charAt(index));
        const end = space ? index + 1 : commentEnd(text, index, blocks);
        if (end === -1) break;
        lineBreak ||= LINE_TERMINATOR.test(text.slice(index, end));
        index = end;
    }
    return { index, lineBreak };
}

/**
 * Read the template piece at `index`, if one opens there, and track the
 * placeholder it opens or closes.
 *
 * @param text - The text.
 * @param index - Index of a code character.
 * @param braces - The walk's brace depths.
 * @returns The piece's end, exclusive, or -1 when no piece opens here.
 */
function templatePieceEnd(text: string, index: number, braces: BraceState): number {
    const char = text.charAt(index);
    const resumes = char === '}' && braces.resume.at(-1) === braces.depth - 1;
    if (char !== '`' && !resumes) return -1;
    if (resumes) {
        braces.resume.pop();
        braces.depth -= 1;
    }
    const end = templateEnd(text, index);
    if (text.charAt(end - 1) === '{' && text.charAt(end - 2) === '$' && end - 2 > index) {
        braces.resume.push(braces.depth);
        braces.depth += 1;
    }
    return end;
}

/**
 * Read the token that opens at `index`, if one does, into `token.kind`.
 *
 * @param text - The text.
 * @param index - Index of a character that is not whitespace.
 * @param previous - Index of the code character before it, or -1.
 * @param state - The token to fill and the walk's brace depths.
 * @param state.token - Receives the token's kind.
 * @param state.braces - The walk's brace depths.
 * @param state.blocks - What earlier searches for `*\/` found.
 * @returns The token's end, exclusive, or -1 when the character is code.
 */
function tokenEnd(
    text: string,
    index: number,
    previous: number,
    state: { token: JsToken; braces: BraceState; blocks: BlockCloseState },
): number {
    const char = text.charAt(index);
    const comment = commentEnd(text, index, state.blocks);
    if (comment !== -1) {
        state.token.kind = 'comment';
        return comment;
    }
    const piece = templatePieceEnd(text, index, state.braces);
    if (piece !== -1) {
        state.token.kind = 'template';
        return piece;
    }
    if (char === '"' || char === "'") {
        state.token.kind = 'string';
        return quotedEnd(text, index);
    }
    if (char === '/' && regexCanStart(text, previous)) {
        state.token.kind = 'regex';
        return regexEnd(text, index);
    }
    return -1;
}

/**
 * Count a code brace into the walk's depth.
 *
 * @param braces - The walk's brace depths.
 * @param char - A code character.
 */
function countBrace(braces: BraceState, char: string): void {
    if (char === '{') braces.depth += 1;
    else if (char === '}' && braces.depth > 0) braces.depth -= 1;
}

/**
 * Hand each comment, string, template piece and regular expression in
 * `text` to `visit`, in order. The walk stops when `visit` returns true.
 *
 * @param text - JavaScript or TypeScript source.
 * @param visit - Called with each token; the object is reused, so copy what
 *        outlives the call.
 * @param options - How the text is read.
 * @returns True when `visit` stopped the walk.
 */
export function walkJsTokens(
    text: string,
    visit: (token: JsToken) => boolean,
    options: JsLexOptions = {},
): boolean {
    const state = {
        token: { kind: 'string', start: 0, end: 0, previous: -1 } as JsToken,
        braces: { depth: 0, resume: [] } as BraceState,
        blocks: blockCloseState(text, options),
    };
    let previous = -1;
    let index = 0;
    while (index < text.length) {
        const char = text.charAt(index);
        const end = isSpace(char) ? -1 : tokenEnd(text, index, previous, state);
        if (end === -1) {
            if (!isSpace(char)) {
                countBrace(state.braces, char);
                previous = index;
            }
            index += 1;
            continue;
        }
        state.token.start = index;
        state.token.end = end;
        state.token.previous = previous;
        if (visit(state.token)) return true;
        if (state.token.kind !== 'comment') previous = end - 1;
        index = end;
    }
    return false;
}

/**
 * Hand each string, template piece and regular expression in `text` to
 * `visit`, in order, skipping comments. The walk stops when `visit` returns
 * true.
 *
 * @param text - JavaScript or TypeScript source.
 * @param visit - Called with each literal; the object is reused, so copy what
 *        outlives the call.
 * @returns True when `visit` stopped the walk.
 */
export function walkJsLiterals(text: string, visit: (literal: JsLiteral) => boolean): boolean {
    return walkJsTokens(text, token => token.kind !== 'comment' && visit(token as JsLiteral));
}

/**
 * The text with each `//` and `/*` comment replaced by spaces, its line
 * breaks kept, so every offset and line number stays where it was. A
 * hashbang is left as written: it holds no code to hide.
 *
 * @param text - JavaScript or TypeScript source.
 * @param options - How the text is read.
 * @returns The masked text; the same string when it holds no comment opener.
 */
export function maskJsComments(text: string, options: JsLexOptions = {}): string {
    if (!text.includes('/')) return text;
    const parts: string[] = [];
    let copied = 0;
    walkJsTokens(
        text,
        token => {
            if (token.kind === 'comment' && text.charAt(token.start) === '/') {
                parts.push(
                    text.slice(copied, token.start),
                    text.slice(token.start, token.end).replace(/[^\n]/g, ' '),
                );
                copied = token.end;
            }
            return false;
        },
        options,
    );
    parts.push(text.slice(copied));
    return parts.join('');
}

/**
 * The code alone: every comment, string, regular expression and template
 * piece removed, the code in a template's placeholders kept.
 *
 * @param text - JavaScript or TypeScript source.
 * @returns The code.
 */
export function stripJsCommentsAndLiterals(text: string): string {
    const parts: string[] = [];
    let copied = 0;
    walkJsTokens(text, token => {
        parts.push(text.slice(copied, token.start));
        copied = token.end;
        return false;
    });
    parts.push(text.slice(copied));
    return parts.join('');
}
