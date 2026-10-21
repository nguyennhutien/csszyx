/**
 * What a session that keeps going says about a stylesheet edit it cannot
 * read: the dev server and `csszyx next watch` both report the error and go
 * on with what they had.
 *
 * @module kept-session-message
 */

import { isCsszyxError } from '@csszyx/compiler/errors';

/**
 * The error's message with the session's own note above its `docs:` line.
 *
 * A prefix disagreement's build note says nothing was written, which is not
 * true of a session that goes on, so that note is dropped.
 *
 * @param error - What reading the stylesheets threw.
 * @param note - What the session goes on with, as the `note:` line says it.
 * @returns The warning.
 */
export function keptSessionMessage(error: unknown, note: string): string {
    let message = (error as Error).message;
    if (isCsszyxError(error) && error.code === 'prefix-disagreement') {
        message = message.replace(/^ {2}note: .*\n/m, '');
    }
    // Above the closing `docs:` line, or last when there is none.
    return message.replace(/(\n {2}docs: [^\n]*)?$/, (docs = '') => `\n  note: ${note}${docs}`);
}
