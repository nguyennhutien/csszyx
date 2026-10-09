/**
 * Which engine diagnostics a bundler lane prints, and where.
 *
 * Every lane that lowers `sz` gets the same list back from the engine, and
 * every one of them has to make the same calls about it: which level the
 * project's `csszyx.config` gives each finding, what that level prints in a
 * dev server and in a production build, what `quiet` mutes. The Vite and
 * webpack plugin made those calls inline, and the Next Turbopack loader made
 * none — it never read the list, so a key 0.18.0 removed lowered to nothing
 * there without a word. One router, so a lane cannot drift from the others by
 * forgetting a branch.
 *
 * The router reads the engine's code for each diagnostic, never its wording;
 * the text is consulted only for a line that carries no code.
 *
 * @module
 */
import { szDiagnosticKindOf, szKeySuggestionFor } from '@csszyx/compiler';
import type { SzDiagnosticLevel } from '@csszyx/types';

import type { DiagnosticLimiter } from './diagnostic-limiter.js';
import { createDiagnosticPolicy, type DiagnosticPolicy } from './diagnostic-policy.js';

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

/** Where one finding at a level goes. */
export type FindingChannel = 'drop' | 'held' | 'list';

/**
 * Where a finding at a level goes on this run.
 *
 * The one mapping every lane shares: `off` is dropped; `info` is listed while
 * someone is developing and only counted where a build holds advice back;
 * `warn` and `error` are listed in every mode, since the level says the reader
 * has to see them. A level never fails a build. `quiet: true` mutes all of it.
 *
 * @param level - The level the policy gave the finding.
 * @param quiet - Resolved quiet mode.
 * @param holdInfo - Whether this run counts `info` findings instead of listing them.
 * @returns The channel.
 */
export function channelOfLevel(
    level: SzDiagnosticLevel,
    quiet: QuietMode,
    holdInfo: boolean,
): FindingChannel {
    if (quiet === 'all' || level === 'off') return 'drop';
    if (level === 'info') return holdInfo ? 'held' : 'list';
    return 'list';
}

/** Where the engine placed one diagnostic, index-parallel to the list. */
export interface DiagnosticIssue {
    code: string;
    line: number;
    column: number;
}

/** One module's diagnostics, and how this run reports them. */
export interface TransformDiagnosticsInput {
    /** The engine's diagnostics for the module, in order. */
    diagnostics: readonly string[];
    /**
     * The code and position of each, index-parallel. A diagnostic without one
     * (a cache entry from before codes, a line the runtime lowering shares
     * wording with) is classified by its text.
     */
    issues?: ReadonlyArray<DiagnosticIssue | undefined>;
    /** The module identifier the lines name. */
    id: string;
    /** The file relative to the project root, for `overrides` and the dedupe. */
    file?: string;
    /** Resolved quiet mode. */
    quiet: QuietMode;
    /** Whether this run counts `info` findings instead of listing them. */
    holdInfo: boolean;
    /** The project's policy; the built-in levels when omitted. */
    policy?: DiagnosticPolicy;
    /** The lane's dedupe record and cap; every line is listed when omitted. */
    limiter?: DiagnosticLimiter;
}

/** One transform's diagnostics, sorted into the channels a lane prints them on. */
export interface RoutedTransformDiagnostics {
    /**
     * Unresolvable-spread reports, as `<id>:<line>:<column>\n  <message>`
     * without the prefix. The plugin collects them for the end of the build;
     * a loader prints them at once.
     */
    spread: string[];
    /** `warn` and `error` lines, printed now in every mode. */
    immediate: string[];
    /** `info` lines to list, empty when the run holds them back. */
    advisories: string[];
    /** How many `info` findings the run held back instead of listing. */
    heldAdvisories: number;
}

/** The policy a caller that names none gets, built once. */
const DEFAULT_POLICY = createDiagnosticPolicy();

/**
 * Sort one transform's diagnostics into the channels a lane prints them on.
 *
 * Each diagnostic's kind is the engine's code for it, and its level is what
 * the project's policy gives that kind in this file. The wording decides
 * nothing for a diagnostic that carries a code: a reworded message cannot move
 * between channels. Pure apart from the limiter, so the plugin, the Next
 * loader and jest share it and a test reads it without a bundler.
 *
 * @param input - The module's diagnostics and how this run reports them.
 * @returns The lines for each channel.
 */
export function routeTransformDiagnostics(
    input: TransformDiagnosticsInput,
): RoutedTransformDiagnostics {
    const { diagnostics, issues, id, quiet, holdInfo, limiter } = input;
    const policy = input.policy ?? DEFAULT_POLICY;
    const file = input.file ?? id;
    const routed: RoutedTransformDiagnostics = {
        spread: [],
        immediate: [],
        advisories: [],
        heldAdvisories: 0,
    };
    for (const [index, message] of diagnostics.entries()) {
        const issue = issues?.[index];
        const kind = issue?.code ?? szDiagnosticKindOf(message);
        const level = policy.levelOf({ rule: 'sz-diagnostic', kind, file: input.file });
        const channel = channelOfLevel(level, quiet, holdInfo);
        if (channel === 'drop') continue;
        if (channel === 'held') {
            routed.heldAdvisories++;
            continue;
        }
        if (limiter?.admit({ id: kind, file, line: issue?.line, key: message }) === false) {
            continue;
        }
        const where = issue === undefined ? id : `${id}:${issue.line}:${issue.column}`;
        if (kind === 'unresolvable-spread') {
            routed.spread.push(`${where}\n  ${message}`);
            continue;
        }
        // A suggestion is a hint beside the diagnostic; nothing is rewritten.
        const suggestion = szKeySuggestionFor(message);
        const hint = suggestion === null ? '' : `\n  Did you mean "${suggestion}"?`;
        const line = `[csszyx] ${where}\n  ${message}${hint}`;
        if (level === 'info') routed.advisories.push(line);
        else routed.immediate.push(line);
    }
    return routed;
}
