/**
 * Which kind of problem a rendered engine diagnostic reports.
 *
 * Both engine artifacts return diagnostics as text. A consumer that wants to
 * treat kinds differently — a CI gate that fails on a typo'd key and not on a
 * precedence note, a build that holds advice back in production — otherwise
 * matches the English, and a reworded message turns such a gate green without
 * a word. This module is that match, kept in the package that owns the wording
 * and pinned against real engine output by its tests, so a reworded message
 * fails here rather than in someone's pipeline. Structured fields on the
 * engine result would replace it; this is the single point of coupling until
 * they exist.
 *
 * @module sz-diagnostic-kind
 */

import { szFallbackConsequenceOf } from './sz-fallback-matrix.js';

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

/** A kind `csszyx check` can report, or `other` for a message no matcher accepts. */
export type SzDiagnosticKindId =
    | 'unknown-key'
    | 'canonical-key'
    | 'removed-key'
    | 'numeric-key'
    | 'closed-enum-value'
    | 'off-scale-value'
    | 'numeric-font-weight'
    | 'per-side-border-style'
    | 'property-object'
    | 'non-variant-object'
    | 'unknown-field'
    | 'runtime-value'
    | 'unresolvable-spread'
    | 'style-override'
    | 'szs-slot-map'
    | 'sz-recover'
    | 'class-precedence'
    | 'duplicate-sz'
    | 'other';

/**
 * Kinds in match order, each tested against the message with its tag removed.
 * No two matchers accept the same engine message, so the order only decides
 * where a lookup stops.
 *
 * Only diagnostics `csszyx check` reports have a kind. A runtime fallback
 * carries no `[csszyx]` tag and a mangleVars note needs an option `check` does
 * not pass, so a kind for either would be an id `--rule` accepts and never
 * selects. Both still count as advisory below.
 */
const KINDS: ReadonlyArray<
    readonly [id: Exclude<SzDiagnosticKindId, 'other'>, advisory: boolean, KindMatcher]
> = [
    ['unknown-key', false, { startsWith: 'Unknown property "' }],
    ['canonical-key', false, { startsWith: 'Use the canonical key "' }],
    ['removed-key', false, { pattern: /^"[^"]+" (?:boolean sugar )?was removed at / }],
    ['numeric-key', false, { startsWith: 'sz received a numeric key "' }],
    ['closed-enum-value', false, { startsWith: '"', includes: ' value. The class "' }],
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
    ['runtime-value', false, { includes: ' cannot take a runtime value at ' }],
    ['unresolvable-spread', false, { startsWith: 'unresolvable sz spread at ' }],
    ['style-override', false, { startsWith: 'possible style override at ' }],
    ['szs-slot-map', false, { startsWith: 'szs at ' }],
    ['sz-recover', false, { startsWith: 'szRecover at ' }],
    ['class-precedence', true, { includes: 'takes precedence over the runtime "className"' }],
    ['duplicate-sz', true, { includes: '`sz` attributes; they were merged as sz={[' }],
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
 * Every id {@link szDiagnosticKindOf} can return, `other` last, for validating
 * an id a user typed: a misspelt id that matched nothing would select nothing
 * and pass.
 */
export const SZ_DIAGNOSTIC_KIND_IDS: readonly SzDiagnosticKindId[] = [
    ...KINDS.map(([id]) => id),
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
 * A message no kind accepts is `other`, so a consumer that selects kinds never
 * silently loses one it could not read.
 *
 * @param message - One diagnostic line, with or without the `[csszyx]` tag.
 * @returns The kind id.
 * @example
 * szDiagnosticKindOf('[csszyx] Unknown property "workBreak" in sz prop at a.tsx:1.');
 * // 'unknown-key'
 */
export function szDiagnosticKindOf(message: string): SzDiagnosticKindId {
    return classify(message)[0];
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
