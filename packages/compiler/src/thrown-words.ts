/**
 * The words of a line Node prints or throws from a module the engine entries
 * load (`./engine`, `./internal`, `./migrate`), in the engine renderer's
 * layout, from one browser-module export: the entry carries the words of the
 * ids it reports and no others, and no second renderer.
 *
 * @module thrown-words
 */

import { szDiagnosticRenderer } from './diagnostic-render.js';
import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from './diagnostic-render-helpers.js';
import type { SzBrowserDiagnostic } from './diagnostic-template.js';

/** Where a diagnostic is: a file, and a line and column for a site. */
export interface ThrownPlace {
    /** The file as the reader should see it; `''` when unknown. */
    file: string;
    /** 1-based line. */
    line?: number;
    /** 1-based column. */
    column?: number;
}

/**
 * The whole message of a diagnostic: the header, the body and the link to
 * its page.
 *
 * @param diagnostic - The id's entry, as the browser module exports it.
 * @param args - Its args.
 * @param place - Where it is; nowhere by default.
 * @returns The message.
 */
export function renderThrown<Args extends object>(
    diagnostic: SzBrowserDiagnostic<Args>,
    args: NoInfer<Args>,
    place?: ThrownPlace,
): string {
    const { file = '', line, column } = place ?? {};
    return szDiagnosticRenderer({ [diagnostic.id]: diagnostic }).message({
        diagnostic: { code: diagnostic.id, args, line, column },
        file,
        computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
    });
}
