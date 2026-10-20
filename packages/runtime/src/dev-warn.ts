/**
 * Shared development-only reporting for the runtime: one de-duplicating,
 * capped sink in front of the compiler's `szReport`, so a hot path (a szv
 * factory rendered per row) cannot spam the console with the same line, and a
 * line built from data cannot grow the cache without bound.
 *
 * A caller names the registry id and its args and sits on the development
 * branch of a literal `process.env.NODE_ENV` check, as every `szReport` call
 * does (ADR 0031): only that check lets a bundler drop the call and the
 * template it names.
 *
 * @module
 */

import { DIAGNOSTICS_CAPPED, type SzReportOptions, szReport } from '@csszyx/compiler/report';

/**
 * Most distinct reports one session will print. Every other cache in the
 * runtime is capped, and this one takes strings interpolated from the user's
 * className — a class built from data (`user-data-${id}`) would otherwise grow
 * it without bound for as long as the dev server runs; measured at 50 000
 * distinct tokens it held 37–59 MB.
 *
 * Admission stops at the cap rather than clearing, because clearing would
 * print the same data-driven flood again every 512 messages. But a cache that
 * goes quiet is a gate that went blind, so the first suppressed message is
 * replaced by one line saying that it happened and what usually causes it
 * (`diagnostics-capped`).
 */
const WARNED_MAX = 512;
const warned = new Set<string>();
/** Whether the one-time "suppressed from here" line has been printed. */
let announcedCap = false;

/**
 * Print a diagnostic in development, once per id and args. After 512 distinct
 * reports, prints one `diagnostics-capped` line saying further ones are
 * suppressed, then stays silent until {@link resetDevWarnCache}. Prints
 * nothing in production.
 *
 * @param options - The id and its args, as `szReport` takes them.
 */
export function devWarn<Args extends object>(options: SzReportOptions<Args>): void {
    if (process.env.NODE_ENV !== 'production') {
        const token = `${options.diagnostic.id}\u0000${JSON.stringify(options.args)}`;
        if (warned.has(token)) return;
        if (warned.size >= WARNED_MAX) {
            if (!announcedCap) {
                announcedCap = true;
                szReport({
                    diagnostic: DIAGNOSTICS_CAPPED,
                    args: { form: 'dev-warnings', count: WARNED_MAX },
                });
            }
            return;
        }
        warned.add(token);
        szReport(options);
    }
}

/**
 * Clear the de-dup cache. Test-only — lets a suite assert the same warning fires
 * again after a reset.
 */
export function resetDevWarnCache(): void {
    warned.clear();
    announcedCap = false;
}
