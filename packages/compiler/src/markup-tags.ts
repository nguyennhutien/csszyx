/**
 * Read the markup of a component file the way its framework's parser does,
 * one `<` at a time: a comment, `<!…>` and `<?…>` are spans to skip, a quoted
 * attribute value is read whole, and a `<` that starts none of them is text.
 * The Vue adapter finds its root `<template>` with it and the Svelte adapter
 * its `<script>` and `<style>` blocks; Svelte also reads a `{ }` expression in
 * a start tag whole (see {@link MarkupSyntax}).
 *
 * Every reader here moves forward from where it is given and stops at the
 * first answer, so a caller that resumes past each answer reads a file in time
 * linear in its length. `n` is the length of the source.
 *
 * @module
 */

/** One tag read from its `<`. */
export interface MarkupTag {
    /** Lower-cased tag name. */
    name: string;
    /** Whether it is an end tag (`</name>`). */
    closing: boolean;
    /** Whether it ends in `/>`. */
    selfClosing: boolean;
    /** Index just past its `>`. */
    end: number;
}

/** What starts at a `<`: a tag, a span to skip, text, or input that never closes. */
export type Markup = MarkupTag | { skip: number } | 'text' | 'unclosed';

/** What starts at a `<` when it closes. */
export type ClosedMarkup = Exclude<Markup, 'unclosed'>;

/** What a start tag may hold besides names and quoted values. */
export interface MarkupSyntax {
    /**
     * Whether a `{` in a tag opens an expression read whole, as in Svelte's
     * `on:click={() => a > b}` and `{...rest}`. Off, a `{` is part of a name or
     * an unquoted value, as in Vue.
     */
    expressions?: boolean;
}

/**
 * Whether a character is HTML whitespace.
 *
 * @param char - One character.
 * @returns Whether it is a space, tab, line feed, form feed or carriage return.
 */
function isSpace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

/**
 * Whether a character ends a tag name.
 *
 * @param char - One character; `''` past the end of the source.
 * @returns Whether it is whitespace, `/`, `>` or the end.
 */
function endsTagName(char: string): boolean {
    return char === '' || char === '/' || char === '>' || isSpace(char);
}

/** Words after which a `/` starts a regular expression, not a division. */
const REGEX_AFTER_WORDS = new Set([
    'await',
    'case',
    'delete',
    'do',
    'else',
    'if',
    'in',
    'instanceof',
    'new',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
]);

/**
 * Whether a character continues an identifier, keyword or number.
 *
 * @param char - One character; `''` past the end of the source.
 * @returns Whether it is a letter, digit, `_`, `$` or non-ASCII.
 */
function isWordChar(char: string): boolean {
    return (
        (char >= 'a' && char <= 'z') ||
        (char >= 'A' && char <= 'Z') ||
        (char >= '0' && char <= '9') ||
        char === '_' ||
        char === '$' ||
        char > '\x7f'
    );
}

/**
 * Where a quoted string ends.
 *
 * @param source - The source.
 * @param open - Index of its opening quote.
 * @returns The index of its closing quote, or -1 when it never closes.
 */
function stringEnd(source: string, open: number): number {
    const quote = source.charAt(open);
    for (let index = open + 1; index < source.length; index += 1) {
        const char = source.charAt(index);
        if (char === '\\') index += 1;
        else if (char === quote) return index;
    }
    return -1;
}

/**
 * Where a regular expression literal's body ends. A `/` inside a `[ ]` class
 * or after a backslash does not end it, and neither may a line break.
 *
 * @param source - The source.
 * @param open - Index of its opening `/`.
 * @returns The index of its closing `/`, or -1 when it never closes.
 */
function regexEnd(source: string, open: number): number {
    let inClass = false;
    for (let index = open + 1; index < source.length; index += 1) {
        const char = source.charAt(index);
        if (char === '\n' || char === '\r') return -1;
        if (char === '\\') index += 1;
        else if (char === '[') inClass = true;
        else if (char === ']') inClass = false;
        else if (char === '/' && !inClass) return index;
    }
    return -1;
}

/**
 * Where a comment that starts at a `/` ends, when one does.
 *
 * @param source - The source.
 * @param slash - Index of a `/`.
 * @returns The index of the comment's last character; `slash - 1` when no
 *   comment starts there; -1 when a block comment never closes.
 */
function commentEnd(source: string, slash: number): number {
    const next = source.charAt(slash + 1);
    if (next === '/') {
        const lineEnd = source.indexOf('\n', slash + 2);
        return lineEnd === -1 ? source.length - 1 : lineEnd;
    }
    if (next !== '*') return slash - 1;
    const close = source.indexOf('*/', slash + 2);
    return close === -1 ? -1 : close + 1;
}

/** The state of {@link braceGroupEnd} between two steps. */
interface ExpressionScan {
    /** The open braces and template literals, innermost last. */
    readonly open: Array<'{' | '`'>;
    /** Whether a `/` here starts a regular expression. */
    regexAllowed: boolean;
}

/**
 * One step through the text of a template literal.
 *
 * @param source - The source.
 * @param index - Index of a character inside the literal's text.
 * @param scan - The scan state.
 * @returns The index of the last character the step read.
 */
function templateStep(source: string, index: number, scan: ExpressionScan): number {
    const char = source.charAt(index);
    if (char === '\\') return index + 1;
    if (char === '`') {
        scan.open.pop();
        scan.regexAllowed = false;
    } else if (char === '$' && source.charAt(index + 1) === '{') {
        scan.open.push('{');
        scan.regexAllowed = true;
        return index + 1;
    }
    return index;
}

/**
 * One step through code that starts with a `/`: a comment, a regular
 * expression or a division.
 *
 * @param source - The source.
 * @param index - Index of the `/`.
 * @param scan - The scan state.
 * @returns The index of the last character the step read, or -1 when what it
 *   started never closes.
 */
function slashStep(source: string, index: number, scan: ExpressionScan): number {
    const comment = commentEnd(source, index);
    if (comment !== index - 1) return comment;
    if (!scan.regexAllowed) {
        scan.regexAllowed = true;
        return index;
    }
    const close = regexEnd(source, index);
    if (close === -1) return -1;
    let flagsEnd = close;
    while (isWordChar(source.charAt(flagsEnd + 1))) flagsEnd += 1;
    scan.regexAllowed = false;
    return flagsEnd;
}

/**
 * One step through code: a token, a comment or one character.
 *
 * @param source - The source.
 * @param index - Index of a character of code.
 * @param scan - The scan state.
 * @returns The index of the last character the step read, or -1 when what it
 *   started never closes.
 */
function codeStep(source: string, index: number, scan: ExpressionScan): number {
    const char = source.charAt(index);
    if (char === '"' || char === "'") {
        scan.regexAllowed = false;
        return stringEnd(source, index);
    }
    if (char === '/') return slashStep(source, index, scan);
    if (isWordChar(char)) {
        let wordEnd = index;
        while (isWordChar(source.charAt(wordEnd + 1))) wordEnd += 1;
        scan.regexAllowed = REGEX_AFTER_WORDS.has(source.slice(index, wordEnd + 1));
        return wordEnd;
    }
    if (char === '`') scan.open.push('`');
    else if (char === '{') scan.open.push('{');
    else if (char === '}') scan.open.pop();
    if (!isSpace(char)) scan.regexAllowed = char !== ')' && char !== ']' && char !== '}';
    return index;
}

/**
 * Where a JavaScript expression that starts at a `{` ends. Braces nest. A
 * string, a template literal (with its `${ }` substitutions), a comment and a
 * regular expression are each read whole, so a brace or a quote inside one
 * does not count; a `/` is a regular expression where an operand may start
 * and a division after one. A `/` right after the opening brace that starts
 * no comment closes a Svelte block (`{/if}`), as Svelte reads it. O(n) from
 * `open`.
 *
 * @param source - The source.
 * @param open - Index of the opening `{`.
 * @returns The index of the matching `}`, or -1 when it never closes.
 * @internal Shared by the framework adapters; not a stable API.
 */
export function braceGroupEnd(source: string, open: number): number {
    if (source.charAt(open + 1) === '/' && commentEnd(source, open + 1) === open) {
        return source.indexOf('}', open + 2);
    }
    const scan: ExpressionScan = { open: ['{'], regexAllowed: true };
    let index = open + 1;
    while (index < source.length) {
        const inTemplate = scan.open[scan.open.length - 1] === '`';
        const last = inTemplate ? templateStep(source, index, scan) : codeStep(source, index, scan);
        if (last === -1) return -1;
        if (scan.open.length === 0) return last;
        index = last + 1;
    }
    return -1;
}

/**
 * Where a value read whole inside a tag ends: a quoted attribute value, or an
 * expression when the syntax has them.
 *
 * @param source - Lower-cased source.
 * @param index - Index of a character in the tag that is not whitespace.
 * @param afterEquals - Whether it follows an `=`.
 * @param syntax - What else the tag may hold.
 * @returns The index of the value's closing quote or brace, `index` itself
 *   when no such value starts there, or -1 when it never closes.
 */
function valueEnd(
    source: string,
    index: number,
    afterEquals: boolean,
    syntax: MarkupSyntax,
): number {
    const char = source.charAt(index);
    if (afterEquals && (char === '"' || char === "'")) return source.indexOf(char, index + 1);
    if (syntax.expressions && char === '{') return braceGroupEnd(source, index);
    return index;
}

/**
 * Where a tag's `>` is, from just past its name. A quoted attribute value is
 * read whole; a quote anywhere else is part of a name or an unquoted value.
 *
 * @param source - Lower-cased source.
 * @param from - Index just past the tag name.
 * @param syntax - What else the tag may hold.
 * @returns The index of the `>`, or -1 when the tag never closes.
 */
function tagEnd(source: string, from: number, syntax: MarkupSyntax): number {
    let afterEquals = false;
    let index = from;
    while (index < source.length) {
        const char = source.charAt(index);
        if (char === '>') return index;
        if (char === '=') {
            afterEquals = true;
        } else if (!isSpace(char)) {
            index = valueEnd(source, index, afterEquals, syntax);
            if (index === -1) return -1;
            afterEquals = false;
        }
        index += 1;
    }
    return -1;
}

/**
 * Read what starts at a `<`.
 *
 * @param source - Lower-cased source.
 * @param at - Index of the `<`.
 * @param syntax - What a start tag may hold besides names and quoted values.
 * @returns The tag, a span to skip (a comment, `<!…>`, `<?…>`), `'text'` for a
 *   `<` that starts none of them, or `'unclosed'`.
 * @internal Shared by the framework adapters; not a stable API.
 */
export function readMarkup(source: string, at: number, syntax: MarkupSyntax = {}): Markup {
    if (source.startsWith('<!--', at)) {
        const close = source.indexOf('-->', at + 4);
        return close === -1 ? 'unclosed' : { skip: close + 3 };
    }
    const next = source.charAt(at + 1);
    if (next === '!' || next === '?') {
        const close = source.indexOf('>', at + 2);
        return close === -1 ? 'unclosed' : { skip: close + 1 };
    }
    const closing = next === '/';
    const nameStart = closing ? at + 2 : at + 1;
    const first = source.charAt(nameStart);
    if (first < 'a' || first > 'z') return 'text';
    let nameEnd = nameStart + 1;
    while (!endsTagName(source.charAt(nameEnd))) nameEnd += 1;
    const close = tagEnd(source, nameEnd, syntax);
    if (close === -1) return 'unclosed';
    return {
        name: source.slice(nameStart, nameEnd),
        closing,
        selfClosing: source.charAt(close - 1) === '/',
        end: close + 1,
    };
}

/**
 * Where scanning resumes after what starts at a `<`.
 *
 * @param markup - What {@link readMarkup} read there.
 * @param at - Index of the `<`.
 * @returns The index after it.
 * @internal Shared by the framework adapters; not a stable API.
 */
export function markupResume(markup: ClosedMarkup, at: number): number {
    if (markup === 'text') return at + 1;
    return 'skip' in markup ? markup.skip : markup.end;
}

/**
 * Whether what was read is a start tag that opens an element.
 *
 * @param markup - What {@link readMarkup} read.
 * @returns Whether it is a tag that is neither an end tag nor self-closing.
 * @internal Shared by the framework adapters; not a stable API.
 */
export function isOpeningTag(markup: ClosedMarkup): markup is MarkupTag {
    return typeof markup === 'object' && 'name' in markup && !markup.closing && !markup.selfClosing;
}

/**
 * Where a raw-text element ends: just past its own end tag. `</scripts>` does
 * not end a `<script>`. O(n) from `from`.
 *
 * @param source - Lower-cased source.
 * @param name - The element's tag name.
 * @param from - Offset just past its start tag.
 * @returns The offset, or -1 when it never closes.
 * @internal Shared by the framework adapters; not a stable API.
 */
export function rawTextEnd(source: string, name: string, from: number): number {
    const needle = `</${name}`;
    for (
        let close = source.indexOf(needle, from);
        close !== -1;
        close = source.indexOf(needle, close + 2)
    ) {
        if (!endsTagName(source.charAt(close + needle.length))) continue;
        const end = tagEnd(source, close + needle.length, {});
        return end === -1 ? -1 : end + 1;
    }
    return -1;
}
