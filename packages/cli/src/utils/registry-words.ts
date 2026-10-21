/**
 * The registry's words for a line the CLI prints or throws itself, outside a
 * `csszyx check` finding.
 *
 * Every Node line is worded once, in the diagnostic registry: a command that
 * kept its own sentence printed words the code's `/e/` page did not have.
 *
 * @module
 */

import {
    renderSzDiagnostic,
    SZ_DIAGNOSTIC_COMPUTED_VALUES,
    type SzDiagnosticArgs,
    type SzDiagnosticId,
    type SzTypedDiagnostic,
    szDiagnosticError,
} from '@csszyx/compiler';
import type { CsszyxError, CsszyxErrorOptions } from '@csszyx/compiler/errors';

/**
 * A diagnostic as a terminal prints it: the header, the sentence, its
 * `help:` and `note:` lines and the link to its page.
 *
 * @param diagnostic - The code and its args, typed by the registry.
 * @param file - The file the header names, for a code about one; none by default.
 * @returns The message.
 */
export function registryMessage<C extends SzDiagnosticId>(
    diagnostic: SzTypedDiagnostic<C>,
    file = '',
): string {
    return renderSzDiagnostic({ diagnostic, file, computed: SZ_DIAGNOSTIC_COMPUTED_VALUES });
}

/**
 * A csszyx error in the registry's words, for a command that stops on it.
 *
 * @param code - The registry id.
 * @param args - The values its message names, typed by the registry.
 * @param options - Where it is and what it wraps.
 * @param options.file - The file the header names, for a code about one.
 * @param options.cause - The error it wraps, when it wraps one.
 * @returns The error, its message the registry's words.
 */
export function registryError<C extends CsszyxErrorOptions['code']>(
    code: C,
    args: SzDiagnosticArgs[C],
    options: { file?: string; cause?: unknown } = {},
): CsszyxError {
    return szDiagnosticError(code, args, { at: options.file, cause: options.cause });
}
