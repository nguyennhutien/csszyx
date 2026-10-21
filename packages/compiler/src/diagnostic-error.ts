/**
 * A Node line or throw in the registry's words, for every Node package that
 * reports one itself: the build plugins, the CLI and the Tailwind oracle pass
 * an id and its args, and never write the sentence (ADR 0031).
 *
 * @module diagnostic-error
 */

import type {
    SzDiagnosticArgs,
    SzDiagnosticId,
    SzErrorCode,
} from './diagnostic-codes.generated.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from './diagnostic-render-helpers.js';
import { renderSzDiagnostic } from './diagnostic-render-root.js';
import { CsszyxError, type CsszyxErrorArgs } from './errors.js';

/**
 * A diagnostic in its full form: `[csszyx] <id>:`, the place when it has one,
 * the sentence, `help:` and `note:` lines, and the link to its page.
 *
 * @param code - The registry id.
 * @param args - Its args, by the registry's names and types: one left out or
 *        of another type, or a form the id does not have, fails to compile.
 * @param at - The file it is about, as the reader should see it; only an id
 *        whose position is a file or a site prints it.
 * @returns The message.
 * @internal Shared by csszyx's own packages; not a stable API.
 */
export function szDiagnosticMessage<C extends SzDiagnosticId>(
    code: C,
    args: SzDiagnosticArgs[C],
    at = '',
): string {
    return renderSzDiagnostic({
        diagnostic: { code, args },
        file: at,
        computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
    });
}

/** Where a thrown diagnostic is, and what it wraps. */
export interface SzDiagnosticErrorOptions {
    /** The file it is about, for an id whose position is a file. */
    readonly at?: string;
    /** The error it wraps. */
    readonly cause?: unknown;
}

/**
 * A csszyx error worded by the registry, with its code and args set, for a
 * site to throw.
 *
 * @param code - The registry id; one with an `error` surface.
 * @param args - Its args, checked as {@link szDiagnosticMessage} checks them.
 * @param options - Where it is, and the error it wraps.
 * @returns The error.
 * @internal Shared by csszyx's own packages; not a stable API.
 */
export function szDiagnosticError<C extends SzErrorCode>(
    code: C,
    args: SzDiagnosticArgs[C],
    options: SzDiagnosticErrorOptions = {},
): CsszyxError {
    return new CsszyxError({
        code,
        args: args as CsszyxErrorArgs,
        message: szDiagnosticMessage(code, args, options.at),
        cause: options.cause,
    });
}
