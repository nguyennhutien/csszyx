/**
 * Which engine diagnostics a bundler lane prints, and where.
 *
 * Every lane that lowers `sz` gets the same list back from the engine, and
 * every one of them has to make the same calls about it: a dead key or a
 * class that never reached the safelist prints in production, an advisory
 * waits for a dev server, `quiet` mutes what it says it mutes. The Vite and
 * webpack plugin made those calls inline, and the Next Turbopack loader made
 * none — it never read the list, so a key 0.18.0 removed lowered to nothing
 * there without a word. One router, so a lane cannot drift from the others by
 * forgetting a branch.
 *
 * @module
 */
import {
    isAdvisorySzDiagnostic,
    szFallbackConsequenceOf,
    szKeySuggestionFor,
} from '@csszyx/compiler';

/**
 * Whether a diagnostic is an advisory one — the class a build may hold back.
 *
 * Advisory means one thing: the styles are THERE, and the note is about how
 * they got there. An `sz`-site nudge fallback took the runtime path where a
 * compiled one was possible; the precedence advisory says which of two sources
 * won. Everything else describes output that is absent or dead, and a
 * production build has to print it.
 *
 * Asked positively on purpose. The predicate used to be "not one of three known
 * kinds", which quietly made every key and value diagnostic advisory: a
 * production build of a file with five typo'd keys printed nothing but a census
 * calling them fallbacks, while `csszyx check` on the same tree named all six.
 * The answer now comes from the compiler's diagnostic table, which also names
 * each kind for `csszyx check`, so the markers live beside the wording.
 *
 * @param message - One raw diagnostic line as an engine emitted it.
 * @returns True when the diagnostic is advisory rather than a build result.
 */
export function isAdvisoryDiagnostic(message: string): boolean {
    return isAdvisorySzDiagnostic(message);
}

/**
 * The `quiet` option, normalized.
 *
 * `'all'` is the blunt setting a plain `true` selects; `'nudges'` keeps every
 * report that the build produced less output than it was asked for.
 */
export type QuietMode = 'off' | 'nudges' | 'all';

/**
 * Normalize the authored `quiet` value. Idempotent, so a already-normalized
 * mode passes through unchanged.
 *
 * @param quiet - Authored option value, or an already-resolved mode.
 * @returns The mode the gates read.
 */
export function resolveQuietMode(quiet: boolean | 'nudges' | QuietMode | undefined): QuietMode {
    if (quiet === true || quiet === 'all') return 'all';
    if (quiet === 'nudges') return 'nudges';
    return 'off';
}

/**
 * Emit one key or value diagnostic — the family that says a class is dead.
 *
 * Its own channel because the two that existed both answer a different
 * question: `emitMissingCssFallback` handles fallback sites, and the advisory
 * channel handles notes about styles that ARE present. A typo'd key matched
 * neither, so a production build dropped it on the floor while `csszyx check`
 * on the same tree exited 1 and named it. Muted only by `quiet: true`, on the
 * same reasoning as the missing-css channel: wrong output is not a usage nudge.
 *
 * @param quiet - Resolved quiet mode.
 * @param message - Compiler diagnostic to classify and emit.
 * @param id - Bundler module identifier included in the warning.
 * @param emit - Warning output channel.
 */
export function emitKeyValueDiagnostic(
    quiet: QuietMode,
    message: string,
    id: string,
    emit: (message: string) => void,
): void {
    if (
        resolveQuietMode(quiet) === 'all' ||
        szFallbackConsequenceOf(message) !== undefined ||
        isAdvisoryDiagnostic(message)
    ) {
        return;
    }
    // A suggestion is a hint beside the diagnostic; nothing is rewritten.
    const suggestion = szKeySuggestionFor(message);
    const hint = suggestion === null ? '' : `\n  Did you mean "${suggestion}"?`;
    emit(`[csszyx] ${id}\n  ${message}${hint}`);
}

/**
 * Whether a transform diagnostic describes missing CSS and may be printed.
 *
 * Only the blunt mode hides these. A missing-CSS diagnostic says classes never
 * reached the safelist, so the styles are absent from the output — a build
 * result, not a style opinion, and `'nudges'` exists so a calmer log does not
 * have to cost it.
 *
 * @param quiet - Resolved quiet mode.
 * @param message - Compiler diagnostic to classify.
 * @returns True when the diagnostic is an unsilenced missing-CSS failure.
 */
export function shouldEmitMissingCssFallback(quiet: QuietMode, message: string): boolean {
    return resolveQuietMode(quiet) !== 'all' && szFallbackConsequenceOf(message) === 'missing-css';
}

/**
 * Whether this run holds the advisory fallback list back and counts it instead.
 *
 * A build prints the count once the bundle closes, so holding the list back
 * still leaves a reader a number to act on. A dev server never closes a bundle:
 * anything held back there is held back for good, which is why serving lists
 * its fallbacks whatever the environment says. `NODE_ENV` alone was the whole
 * test, and a monorepo script that exports it while running a dev server turned
 * every advisory into a number nothing would print.
 *
 * @param quiet - Resolved quiet mode.
 * @param serving - Whether this is a dev server rather than a build.
 * @param nodeEnv - `process.env.NODE_ENV` as the process sees it.
 * @returns True when the list is withheld in favour of a count.
 */
export function shouldHoldAdvisories(
    quiet: QuietMode,
    serving: boolean,
    nodeEnv: string | undefined,
): boolean {
    return quiet !== 'off' || (!serving && nodeEnv === 'production');
}

/**
 * Emit one missing-CSS fallback through the caller's output channel.
 *
 * @param quiet - Resolved quiet mode.
 * @param message - Compiler diagnostic to classify and emit.
 * @param id - Bundler module identifier included in the warning.
 * @param emit - Warning output channel.
 */
export function emitMissingCssFallback(
    quiet: QuietMode,
    message: string,
    id: string,
    emit: (message: string) => void,
): void {
    if (shouldEmitMissingCssFallback(quiet, message)) emit(`[csszyx] ${id}\n  ${message}`);
}

/** One transform's diagnostics, sorted into the channels a lane prints them on. */
export interface RoutedTransformDiagnostics {
    /**
     * Unresolvable-spread reports, as `<id>\n  <message>` without the prefix.
     * Printed in every mode and by no `quiet` setting muted; the plugin
     * collects them for the end of the build, a loader prints them at once.
     */
    spread: string[];
    /** Lines printed now in every mode: budget skips, missing CSS, dead keys and values. */
    immediate: string[];
    /** Advisory lines to list, empty when the run holds them back. */
    advisories: string[];
    /** How many advisories the run held back instead of listing. */
    heldAdvisories: number;
}

/**
 * Sort one transform's diagnostics into the channels a lane prints them on.
 *
 * Pure, so the plugin and the Next loader share the policy and a test reads it
 * without a bundler.
 *
 * @param diagnostics - The engine's diagnostics for one module, in order.
 * @param id - Module identifier the lines name.
 * @param quiet - Resolved quiet mode.
 * @param holdAdvisories - Whether this run counts advisories instead of listing them.
 * @returns The lines for each channel.
 */
export function routeTransformDiagnostics(
    diagnostics: readonly string[],
    id: string,
    quiet: QuietMode,
    holdAdvisories: boolean,
): RoutedTransformDiagnostics {
    const routed: RoutedTransformDiagnostics = {
        spread: [],
        immediate: [],
        advisories: [],
        heldAdvisories: 0,
    };
    const push = (line: string): void => {
        routed.immediate.push(line);
    };
    for (const message of diagnostics) {
        if (message.includes('unresolvable sz spread')) {
            routed.spread.push(`${id}\n  ${message}`);
            continue;
        }
        if (message.includes('AST budget exceeded')) {
            push(`[csszyx] ${id}\n  ${message}`);
            continue;
        }
        // missing-css means the classes never reached the safelist — the
        // styles are simply absent, which is the failure class that must
        // surface in production builds too (same tier as the spread
        // warning above). Only `quiet: true` silences it; `'nudges'` exists
        // precisely so a calmer log does not have to cost this report.
        emitMissingCssFallback(quiet, message, id, push);
        // A dead key or value is the same tier and had no channel at all:
        // it is not a fallback, so the line above skips it, and it is not
        // advice, so the advisory list below skips it too.
        emitKeyValueDiagnostic(quiet, message, id, push);
    }
    const advisories = diagnostics.filter(isAdvisoryDiagnostic);
    if (holdAdvisories) routed.heldAdvisories = advisories.length;
    else routed.advisories = advisories.map(message => `[csszyx] ${id}\n  ${message}`);
    return routed;
}
