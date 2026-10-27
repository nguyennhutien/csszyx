/**
 * The computed values the diagnostic templates name beside their args.
 *
 * Each one reads data both engines take from one source — a table the engine's
 * generated copy is built from, a generated constant — or only presents an arg,
 * so rendering it never runs engine logic a second time (ADR 0031). The
 * registry lists the same names (`COMPUTED` in
 * `scripts/diagnostics/registry.mjs`); a test holds the two lists equal.
 *
 * Node-only by what it adds: the values a browser fills live in
 * `diagnostic-computed.ts`; this module adds the two that read the fallback
 * matrix, which only the build reports.
 *
 * @module diagnostic-render-helpers
 */

import { SZ_BROWSER_DIAGNOSTIC_COMPUTED_VALUES, textArg } from './diagnostic-computed.js';
import type { SzDiagnosticComputed } from './diagnostic-render.js';
import { describeSzFallback, type SzFallbackKind } from './sz-fallback-matrix.js';

/** One arg value, as the wire carries it. */
type Args = Parameters<SzDiagnosticComputed>[0];

/**
 * The fallback matrix's entry for an issue: its `shape`, or the `variant` kind
 * for a variant key, which names the key path in place of a shape.
 *
 * @param args - The issue's args.
 * @returns The reason and the suggestion.
 */
function fallbackOf(args: Args): { reason: string; suggestion: string } {
    if (args.site === 'sz-variant-key') {
        return describeSzFallback('variant', textArg(args, 'keyPath'));
    }
    return describeSzFallback(
        textArg(args, 'shape') as SzFallbackKind,
        textArg(args, 'detail'),
        textArg(args, 'path'),
    );
}

/**
 * Every computed value, by the name a template uses.
 *
 * @internal Used by csszyx's own packages; not a stable API.
 */
export const SZ_DIAGNOSTIC_COMPUTED_VALUES: Readonly<Record<string, SzDiagnosticComputed>> = {
    ...SZ_BROWSER_DIAGNOSTIC_COMPUTED_VALUES,
    fallbackReason: args => fallbackOf(args).reason,
    fallbackSuggestion: args => fallbackOf(args).suggestion,
};
