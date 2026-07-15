const LEADING_WHITESPACE_RE = /^\s+/;
const LINE_COMMENT_RE = /^\/\/[^\n]*(?:\n|$)/;
const BLOCK_COMMENT_RE = /^\/\*[\s\S]*?\*\//;
const USE_DIRECTIVE_RE = /^['"]use (?:client|server)['"];?\s*/;

/**
 * Inserts generated code after a leading React server/client directive.
 *
 * @param code Module source.
 * @param insertion Code to insert.
 * @returns Source with the insertion placed after the directive when present.
 */
export function insertAfterUseDirective(code: string, insertion: string): string {
    let offset = 0;
    while (offset < code.length) {
        const triviaLength = leadingTriviaLength(code.slice(offset));
        if (triviaLength === 0) break;
        offset += triviaLength;
    }

    const directive = code.slice(offset).match(USE_DIRECTIVE_RE);
    if (!directive) return `${insertion}${code}`;

    const insertionOffset = offset + directive[0].length;
    return `${code.slice(0, insertionOffset)}${insertion}${code.slice(insertionOffset)}`;
}

/**
 * Returns the length of one leading whitespace or comment token.
 *
 * @param source Remaining module source.
 * @returns Length of the leading trivia token, or zero when none exists.
 */
function leadingTriviaLength(source: string): number {
    return (
        source.match(LEADING_WHITESPACE_RE)?.[0].length ??
        source.match(LINE_COMMENT_RE)?.[0].length ??
        source.match(BLOCK_COMMENT_RE)?.[0].length ??
        0
    );
}
