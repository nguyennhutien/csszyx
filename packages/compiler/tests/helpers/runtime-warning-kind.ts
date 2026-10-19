/**
 * Which kind of problem a rendered diagnostic reports — a test helper.
 *
 * It was public API until 0.18.0. Every bundler lane and `csszyx check` now
 * read the engine's code, so nothing in the package classifies text any more;
 * the runtime channel's console warnings still carry no code, and the suites
 * that compare them with the engine's codes read their kind here until the
 * runtime reports codes of its own (ADR 0031 PR C), when this file goes.
 *
 * A consumer that treats kinds differently — a CI gate that fails on a typo'd
 * key and not on a precedence note, a build that holds advice back in
 * production — reads the kind here. An engine diagnostic carries its code
 * (`result.issues[i].code`), and the code is the kind. A diagnostic with no
 * code — the runtime channel's console warnings, which share the engine's
 * wording — is matched on its text instead, by the table below, kept in the
 * package that owns the wording and pinned against the engine's own codes by
 * its tests, so a reworded message fails here rather than in someone's
 * pipeline.
 *
 * @module runtime-warning-kind
 */

import {
    SZ_DIAGNOSTIC_CODES,
    type SzDiagnosticCode,
} from '../../src/diagnostic-codes.generated.js';
import { szFallbackConsequenceOf } from '../../src/sz-fallback-matrix.js';

/** The tag every `[csszyx]` diagnostic starts with. */
const TAG = '[csszyx] ';

/**
 * What a message body must look like to be one kind. Every condition given
 * must hold; a kind names at most one of each.
 */
interface KindMatcher {
    startsWith?: string;
    includes?: string;
    pattern?: RegExp;
}

/**
 * A kind this module names: an engine code, or `other` for a message with no
 * code that no text matcher accepts. `other` is no longer a kind `csszyx
 * check` or a bundler lane reports, since every lane keeps the engine's code;
 * `rules` and `--rule` accept it only with a `removed-rule-id` warning.
 */
export type SzDiagnosticKindId = SzDiagnosticCode | 'other';

/**
 * Kinds in match order, each tested against the message with its tag removed,
 * for a diagnostic that carries no code. No two matchers accept the same
 * engine message, so the order only decides where a lookup stops.
 *
 * Only the kinds the runtime channel shares wording with are matched; a
 * diagnostic only the engine or the build-time oracle renders always arrives
 * with its code (`unsigned-value` is the oracle's, the runtime never judges a
 * class — ADR 0022). A runtime
 * fallback and a mangleVars note are left to their codes, and still count as
 * advisory below.
 */
const KINDS: ReadonlyArray<
    readonly [id: Exclude<SzDiagnosticKindId, 'other'>, advisory: boolean, KindMatcher]
> = [
    ['unknown-key', false, { startsWith: 'Unknown property "' }],
    ['canonical-key', false, { startsWith: 'Use the canonical key "' }],
    [
        'removed-key',
        false,
        { pattern: /^"[^"]+" (?:(?:boolean sugar )?was removed|was replaced) at / },
    ],
    ['numeric-key', false, { startsWith: 'sz received a numeric key "' }],
    ['closed-enum-value', false, { startsWith: '"', includes: ' value. The class "' }],
    ['slash-opacity-string', false, { includes: ' — string slash opacity is not supported' }],
    ['color-slash-opacity', false, { includes: ' — a colour object takes its opacity in op' }],
    ['off-scale-value', false, { includes: " is not on Tailwind's spacing scale" }],
    ['numeric-font-weight', false, { includes: 'Tailwind spells a numeric font weight' }],
    ['per-side-border-style', false, { includes: 'Tailwind has no per-side border style' }],
    [
        'property-object',
        false,
        { includes: 'is a property, not a variant, but received an object' },
    ],
    ['non-variant-object', false, { includes: 'is not a variant, but it holds an object' }],
    ['unknown-field', false, { includes: ': unknown field "' }],
    [
        'moved-value',
        false,
        { pattern: /^(?:"[^"]+" moved to \{ |mask: '[^']*'.* — gradient layers moved to ")/ },
    ],
    ['runtime-value', false, { includes: ' cannot take a runtime value at ' }],
    ['unresolvable-spread', false, { startsWith: 'unresolvable sz spread at ' }],
    ['style-override', false, { startsWith: 'possible style override at ' }],
    ['szs-slot-map', false, { startsWith: 'szs at ' }],
    ['sz-recover', false, { startsWith: 'szRecover at ' }],
    ['class-precedence', true, { includes: 'takes precedence over the runtime "className"' }],
    ['duplicate-sz', true, { includes: '`sz` attributes; they were merged as sz={[' }],
    [
        'spread-split-class',
        false,
        { includes: 'on more than one side of a spread stay separate attributes, one per side' },
    ],
];

/** The build's note that the variable-hoist planner declined; every class is still emitted. */
const MANGLE_VARS_HOIST_SKIP = 'mangleVars skipped component CSS variable hoist';

/**
 * Whether a message body satisfies every condition a matcher gives.
 *
 * @param body - The message with its tag removed.
 * @param matcher - The conditions of one kind.
 * @returns True when the body is that kind.
 */
function matchesKind(body: string, matcher: KindMatcher): boolean {
    return (
        (matcher.startsWith === undefined || body.startsWith(matcher.startsWith)) &&
        (matcher.includes === undefined || body.includes(matcher.includes)) &&
        (matcher.pattern === undefined || matcher.pattern.test(body))
    );
}

/**
 * Every id {@link szDiagnosticKindOf} can return — each engine code, `other`
 * last — for validating an id a user typed: a misspelt id that matched
 * nothing would select nothing and pass.
 */
export const SZ_DIAGNOSTIC_KIND_IDS: readonly SzDiagnosticKindId[] = [
    ...SZ_DIAGNOSTIC_CODES,
    'other',
];

/**
 * Kind id and whether it is advisory, for one rendered diagnostic.
 *
 * @param message - One diagnostic line, with or without the `[csszyx]` tag.
 * @returns The id, and true when every class compiled and the note is about how.
 */
function classify(message: string): readonly [id: SzDiagnosticKindId, advisory: boolean] {
    const body = message.startsWith(TAG) ? message.slice(TAG.length) : message;
    for (const [id, advisory, matcher] of KINDS) {
        if (matchesKind(body, matcher)) return [id, advisory];
    }
    const advisory =
        szFallbackConsequenceOf(body) === 'nudge' || body.startsWith(MANGLE_VARS_HOIST_SKIP);
    return ['other', advisory];
}

/**
 * Classify one rendered diagnostic.
 *
 * The engine's code, when the diagnostic has one, is its kind. Without one the
 * text decides, and a message no kind accepts is `other`, so a consumer that
 * selects kinds never silently loses one it could not read.
 *
 * @param message - One diagnostic line, with or without the `[csszyx]` tag.
 * @param code - The code the engine gave it (`result.issues[i].code`), if any.
 * @returns The kind id.
 * @example
 * szDiagnosticKindOf(result.diagnostics[0], result.issues?.[0]?.code);
 * szDiagnosticKindOf('[csszyx] Unknown property "workBreak" in sz prop at a.tsx:1.');
 * // 'unknown-key'
 */
export function szDiagnosticKindOf(message: string, code?: SzDiagnosticCode): SzDiagnosticKindId {
    return code ?? classify(message)[0];
}

/**
 * Whether a diagnostic is advisory: every class compiled, and the note is only
 * about how they got there, such as a precedence note or a fallback whose
 * classes were still collected. A message nothing recognises is not advisory,
 * so a production build still prints it.
 *
 * @param message - One diagnostic line, with or without the `[csszyx]` tag.
 * @returns True when the diagnostic is advisory.
 */
export function isAdvisorySzDiagnostic(message: string): boolean {
    return classify(message)[1];
}
