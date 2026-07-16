const BACKSLASH = String.fromCodePoint(92);

/**
 * Escape content for interpolation into a single-quoted JavaScript string literal.
 *
 * @param value Raw string content.
 * @returns Escaped string literal content.
 */
export function escapeSingleQuotedString(value: string): string {
    return value
        .replaceAll(BACKSLASH, BACKSLASH.repeat(2))
        .replaceAll("'", `${BACKSLASH}'`)
        .replaceAll('\r', `${BACKSLASH}r`)
        .replaceAll('\n', `${BACKSLASH}n`);
}
