/**
 * The shape of an engine diagnostic as a lane reports it (ADR 0031), spelled
 * out by hand so a suite pins the bytes the user reads rather than asking the
 * renderer what it would print.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */

/** The page of a code, appended to the docs line. */
const DOCS = 'https://csszyx.com/e/';

/**
 * One engine message: the header, the body lines, and the docs link.
 *
 * @param code - The diagnostic code.
 * @param where - `file:line:column` (or the file alone); empty for none.
 * @param lines - The body: the sentence, then any `help:` and `note:` lines.
 * @returns The message, its continuation lines indented by two spaces.
 */
export function engineMessage(code: string, where: string, ...lines: string[]): string {
    const place = where === '' ? '' : ` ${where}`;
    return [`[csszyx] ${code}:${place}`, ...lines, `docs: ${DOCS}${code}`].join('\n  ');
}
