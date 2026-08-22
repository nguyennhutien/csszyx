/**
 * Line-ending detection and matching for text the migrator writes into a
 * file it did not author.
 */

/** The two conventions a source file can carry. */
export type LineEnding = '\n' | '\r\n';

/**
 * The convention a file uses, read from its first line break.
 *
 * A file with no line break gets `\n`, which changes nothing: there is no
 * existing line to disagree with.
 *
 * @param source - File contents.
 * @returns The ending every inserted line should use.
 */
export function detectLineEnding(source: string): LineEnding {
    const lf = source.indexOf('\n');
    return lf > 0 && source[lf - 1] === '\r' ? '\r\n' : '\n';
}

/**
 * Rewrite bare `\n` in generated text to the file's convention.
 *
 * Only a `\n` not already preceded by `\r` is touched, so text that already
 * matches passes through unchanged and a double `\r` cannot be produced.
 *
 * @param text - Generated text, written with `\n`.
 * @param eol - The convention of the file it is going into.
 * @returns The text with every line break in that convention.
 */
export function withLineEnding(text: string, eol: LineEnding): string {
    if (eol === '\n') return text;
    return text.replace(/(?<!\r)\n/g, eol);
}
