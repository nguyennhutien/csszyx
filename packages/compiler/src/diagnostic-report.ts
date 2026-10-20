/**
 * `szReport`: how a browser entry prints a diagnostic in development, from
 * the registry's words (ADR 0031).
 *
 * A call site holds the `NODE_ENV` check and calls this only on its
 * development branch; its production branch prints the compact line inline.
 * Nothing here reads `NODE_ENV`: a bundler drops a call, and the templates it
 * names, only when the check sits at the call site.
 *
 * ```ts
 * if (process.env.NODE_ENV !== 'production') {
 *     szReport({ diagnostic: REMOVED_KEY, args: { form: 'removed', key } });
 * }
 * ```
 *
 * A site imports it, and the ids it names, from `@csszyx/compiler/report`,
 * whose entry the generator writes (`report.ts`).
 *
 * Browser-safe: it never imports the Node registry.
 *
 * @internal Shared by csszyx's own packages; not a stable API.
 * @module diagnostic-report
 */

import { SZ_BROWSER_DIAGNOSTIC_COMPUTED_VALUES } from './diagnostic-computed.js';
import {
    type ArgValue,
    fillSzDiagnosticTemplate,
    layoutSzDiagnostic,
    type SzBrowserDiagnostic,
} from './diagnostic-template.js';

/**
 * What to print.
 *
 * @template Args - The args the diagnostic declares.
 */
export interface SzReportOptions<Args extends object> {
    /** The id, as the browser module exports it. */
    readonly diagnostic: SzBrowserDiagnostic<Args>;
    /** Its args, as the registry names them. */
    readonly args: NoInfer<Args>;
    /**
     * Where the diagnostic is (`src/App.tsx:3:9`), when a site knows. The
     * header names it and the sentence follows on its own line, as the
     * engine's messages read; without it the sentence follows the code.
     */
    readonly at?: string;
    /** More console arguments, such as the element, passed after the message. */
    readonly extra?: readonly unknown[];
}

/**
 * Print a diagnostic in its full development form: the code, the sentence,
 * `help:` and `note:` lines, and the link to its page. It prints through
 * `console.error` when the registry marks the line an error, and through
 * `console.warn` otherwise.
 *
 * @internal
 * @param options - What to print.
 */
export function szReport<Args extends object>(options: SzReportOptions<Args>): void {
    const { diagnostic, args, at, extra = [] } = options;
    const parts = fillSzDiagnosticTemplate(
        diagnostic,
        { code: diagnostic.id, args: args as Readonly<Record<string, ArgValue>> },
        SZ_BROWSER_DIAGNOSTIC_COMPUTED_VALUES,
    );
    const message = layoutSzDiagnostic({ code: diagnostic.id, parts, where: at });
    if (diagnostic.console === 'error') console.error(message, ...extra);
    else console.warn(message, ...extra);
}
