/**
 * The CSS reader every pass that skips comments and strings shares.
 *
 * Read as CSS Syntax Level 3 tokenizes them: a comment runs from `/*` to the
 * next `*\/`, or to the end of the text when it never closes; a string runs
 * from its quote to the same quote, an unescaped line break (a bad string),
 * or the end, and a backslash carries the character after it, in a string
 * or out of one. A comment opener inside a string or after a backslash is
 * text.
 *
 * Cost: `n` is the text's length. Each helper searches forward once from
 * where it starts, and the strip visits every index once, so it is `O(n)`.
 * The regex form (`/\/\*[\s\S]*?\*\//`) is polynomial on an unterminated `/*`
 * followed by many `a/*` (CodeQL js/polynomial-redos), which is why none is
 * used. Domain: any text; nothing throws.
 *
 * @module
 */

/**
 * Where a comment that opens at `open` ends.
 *
 * @param css - The stylesheet.
 * @param open - Index of the `/` of `/*`.
 * @returns The index just past `*\/`, or the text's length when it never closes.
 */
export function cssCommentEnd(css: string, open: number): number {
    const close = css.indexOf('*/', open + 2);
    return close === -1 ? css.length : close + 2;
}

/**
 * Where a string that opens at `open` ends.
 *
 * @param css - The stylesheet.
 * @param open - Index of the opening quote.
 * @returns The index just past its closing quote, the index of the unescaped
 *          line break that ends it, or the text's length.
 */
export function cssStringEnd(css: string, open: number): number {
    const quote = css[open];
    for (let index = open + 1; index < css.length; index++) {
        const char = css[index];
        if (char === '\\') index++;
        else if (char === quote) return index + 1;
        else if (char === '\n') return index;
    }
    return css.length;
}

/**
 * Where the text a pass skips at `index` ends: a comment, a string, or an
 * escape, whose backslash carries the character after it, so an escaped
 * quote (`.quote\'s`) opens no string.
 *
 * @param css - The stylesheet.
 * @param index - Index to read from.
 * @returns The index just past what is skipped, or -1 when nothing is.
 */
export function cssOpaqueEnd(css: string, index: number): number {
    const char = css[index];
    if (char === '/' && css[index + 1] === '*') return cssCommentEnd(css, index);
    if (char === '"' || char === "'") return cssStringEnd(css, index);
    if (char === '\\') return Math.min(index + 2, css.length);
    return -1;
}

/** How {@link stripCssBlockComments} reads a comment that never closes. */
export interface StripCssCommentsOptions {
    /**
     * `strip` (the default) removes it to the end of the text, as CSS does;
     * `keep` leaves it and the rest as written, for a scan that would rather
     * read a declaration it should have skipped than drop every one after a
     * stray `/*`.
     */
    unterminated?: 'strip' | 'keep';
}

/**
 * The stylesheet with every block comment removed and every string kept.
 *
 * @param code - CSS source that may contain block comments.
 * @param options - How a comment that never closes is read.
 * @returns The source without its comments.
 */
export function stripCssBlockComments(code: string, options: StripCssCommentsOptions = {}): string {
    if (!code.includes('/*')) return code;
    const keepUnterminated = options.unterminated === 'keep';
    let out = '';
    let copied = 0;
    let index = 0;
    while (index < code.length) {
        const end = cssOpaqueEnd(code, index);
        if (end === -1) {
            index++;
        } else if (code[index] !== '/') {
            index = end;
        } else {
            // A close ends the comment only past its opener: `/*/` is open.
            const closed = end >= index + 4 && code.endsWith('*/', end);
            if (keepUnterminated && !closed) break;
            out += code.slice(copied, index);
            index = end;
            copied = index;
        }
    }
    return out + code.slice(copied);
}
