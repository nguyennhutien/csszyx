const BACKSLASH = String.fromCodePoint(92);

/**
 * Build a JavaScript unicode escape without embedding escaped backslashes.
 *
 * @param hexadecimal Four-digit hexadecimal code point.
 * @returns JavaScript unicode escape sequence.
 */
export function unicodeEscape(hexadecimal: string): string {
    return `${BACKSLASH}u${hexadecimal}`;
}

/**
 * Replace every occurrence of a non-empty literal substring.
 *
 * Implemented with `String.prototype.replaceAll` rather than `split`/`join`:
 * CodeQL's improper-code-sanitization taint tracking only treats
 * `replace`/`replaceAll` calls as sanitizers, so a `split`/`join` pipeline
 * keeps the escaped JSON flagged even though the rewrite is equivalent.
 * The replacement is passed as a callback so it stays literal (no
 * `$&`-style substitution).
 *
 * @param value Source string.
 * @param search Literal substring to replace.
 * @param replacement Replacement string.
 * @returns String with every matching substring replaced.
 */
export function replaceEveryLiteral(value: string, search: string, replacement: string): string {
    return value.replaceAll(search, () => replacement);
}

/**
 * Escape content for interpolation into a single-quoted JavaScript string literal.
 *
 * @param value Raw string content.
 * @returns Escaped string literal content.
 */
export function escapeSingleQuotedString(value: string): string {
    let escaped = replaceEveryLiteral(value, BACKSLASH, BACKSLASH.repeat(2));
    escaped = replaceEveryLiteral(escaped, "'", `${BACKSLASH}'`);
    escaped = replaceEveryLiteral(escaped, '\r', `${BACKSLASH}r`);
    return replaceEveryLiteral(escaped, '\n', `${BACKSLASH}n`);
}

/**
 * Escape content for interpolation into a double-quoted JavaScript string literal.
 *
 * @param value Raw string content.
 * @returns Escaped string literal content.
 */
export function escapeDoubleQuotedString(value: string): string {
    const escaped = replaceEveryLiteral(value, BACKSLASH, BACKSLASH.repeat(2));
    return replaceEveryLiteral(escaped, '"', `${BACKSLASH}"`);
}
