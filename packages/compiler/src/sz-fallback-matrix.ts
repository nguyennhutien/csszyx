/**
 * The single source of truth for "why did this sz expression fall back to
 * runtime, and what should the author do instead".
 *
 * Three engines answer that question — Babel (`transform.ts`), oxc
 * (`transform-oxc.ts`) and Rust (`packages/core`) — and a build may switch
 * between them via `build.parser`. The wording therefore has to be identical
 * across all three: a diagnostic that changes text when the parser changes
 * looks like a behaviour change to whoever is reading the build log.
 *
 * Keeping three hand-written copies in sync is the failure this module exists
 * to prevent. The TypeScript lanes import these templates directly; the Rust
 * lane gets them through `scripts/gen-sz-fallback-matrix.mjs`, whose `--check`
 * mode fails CI when the generated file drifts from this one.
 *
 * @module sz-fallback-matrix
 */

/**
 * Shape of the unresolved expression, as far as the guidance is concerned.
 *
 * Deliberately coarser than any engine's AST: each lane classifies its own
 * node type into one of these, so the matrix stays free of Babel/oxc/oxc-rust
 * node vocabulary.
 */
export type SzFallbackKind = 'call' | 'identifier' | 'member' | 'other';

/** Every kind, in the order the generated Rust match arms are emitted. */
export const SZ_FALLBACK_KINDS: readonly SzFallbackKind[] = [
    'call',
    'identifier',
    'member',
    'other',
];

/** One matrix entry: why the fallback happened, and the way out. */
export interface SzFallbackTemplate {
    /**
     * Reason text. `{detail}` — when present — is replaced with the callee
     * name, identifier name, or node type, depending on the kind.
     */
    reason: string;
    /** Actionable guidance. Never interpolated. */
    suggestion: string;
}

/** Placeholder substituted with the kind-specific detail. */
export const SZ_FALLBACK_DETAIL_PLACEHOLDER = '{detail}';

/**
 * Reason and guidance per expression kind.
 *
 * The wording is a compatibility surface: three engines emit it and tests
 * assert it byte for byte, so treat edits here as user-visible changes.
 */
export const SZ_FALLBACK_MATRIX: Readonly<Record<SzFallbackKind, SzFallbackTemplate>> = {
    call: {
        reason: 'function call `{detail}()` result is unknown at build time',
        suggestion:
            'If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic().',
    },
    identifier: {
        reason: 'identifier `{detail}` could not be resolved to a static value',
        suggestion:
            "Make sure it's a module-level or function-body const with a literal object value. For variant-based styling → szv(). For true runtime values → dynamic().",
    },
    member: {
        reason: 'member expression is not statically resolvable',
        suggestion:
            'Extract the value to a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().',
    },
    other: {
        reason: 'expression of type `{detail}` is not statically analyzable',
        suggestion:
            'Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().',
    },
};

/** A rendered matrix entry, ready to place in a diagnostic. */
export interface SzFallbackDescription {
    reason: string;
    suggestion: string;
}

/**
 * Render one matrix entry.
 *
 * @param kind - Classified shape of the unresolved expression.
 * @param detail - Callee name, identifier name, or node type. Ignored by kinds
 * whose reason carries no placeholder.
 * @returns Reason and suggestion for the diagnostic.
 */
export function describeSzFallback(kind: SzFallbackKind, detail = ''): SzFallbackDescription {
    const template = SZ_FALLBACK_MATRIX[kind];
    return {
        reason: template.reason.split(SZ_FALLBACK_DETAIL_PLACEHOLDER).join(detail),
        suggestion: template.suggestion,
    };
}

/**
 * Fallback name used when a callee has no statically readable name.
 *
 * `sz={obj[key]()}` and `sz={(cond ? a : b)()}` reach the call arm with nothing
 * to print; all three engines emit this same stand-in rather than each choosing
 * their own.
 */
export const SZ_FALLBACK_UNKNOWN_CALLEE = '?';

/**
 * Where an unresolvable expression was found.
 *
 * The reason text describes the EXPRESSION and is shared; the consequence and
 * the way out differ per construct, which is what this selects.
 */
export type SzFallbackSite = 'sz' | 'szr' | 'szv';

/**
 * Guidance for a `szv` config that could not be read at build time.
 *
 * The generic matrix suggestion points at `szv()`, which is circular here — the
 * author is already writing one. What actually matters is that an unreadable
 * config means the variant catalogue is never extracted, so none of its classes
 * reach the safelist and the CSS is simply absent under Tailwind `source(none)`.
 */
export const SZ_FALLBACK_SZV_SUGGESTION: string =
    'Pass the config inline, or as a module-level const object literal. A computed ' +
    'or spread config cannot be read at build time, so none of its variant classes ' +
    'are safelisted and they generate no CSS.';

/**
 * Guidance for an `szs` slot map that is not fully static.
 *
 * Unlike the other sites the advice does not vary by expression kind: the szs
 * contract is that every slot resolves at build time, so the fix is the same
 * whatever shape broke it.
 */
export const SZ_FALLBACK_SZS_SUGGESTION: string =
    'Every slot must be an identifier key with a static object literal (or class ' +
    'string) value. For a value only known at runtime, use dynamic() and pass the ' +
    'resulting class string.';

/** Message prefix per site. */
const SITE_LABEL: Readonly<Record<SzFallbackSite, string>> = {
    sz: 'sz fallback',
    szr: 'szr fallback',
    szv: 'szv catalog',
};

/**
 * What the reader of one diagnostic must fear.
 *
 * `missing-css`: classes were never collected, so nothing downstream was told
 * to generate the CSS the runtime will ask for — an integrity failure that
 * must surface in production builds too. `nudge`: the classes were collected
 * even though the expression itself fell back, so the diagnostic is advisory
 * and stays dev-only.
 *
 * The distinction is what was COLLECTED, not whether a runtime fallback
 * remains — both kinds keep one. A per-file compiler cannot see the project's
 * stylesheet, so neither label may be read as a claim about the final CSS.
 */
export type SzFallbackConsequence = 'missing-css' | 'nudge';

/**
 * The `sz` kinds whose fallback also cost the classes.
 *
 * An unreadable `szr` argument or `szv` config always means the classes never
 * reached the safelist, so those sites need no split. The `sz` site does: it
 * keeps a runtime fallback either way, but what that fallback receives differs
 * by kind. An identifier or member names a value the compiler never sees, so
 * nothing was collected from it — measurably zero classes — and the browser
 * asks for utilities no build step was told to generate. A call and an `other`
 * are not in that position: `dynamic()` is a call and compiles correctly, and
 * an object literal behind `as const` still hands its classes over on the way
 * to the fallback. Reporting those as an integrity failure would fire on
 * working code, which is the one thing a production diagnostic may not do.
 */
const SZ_SITE_MISSING_CSS_KINDS: ReadonlySet<SzFallbackKind> = new Set<SzFallbackKind>([
    'identifier',
    'member',
]);

/**
 * Each kind's reason text up to the point the detail is substituted.
 *
 * Derived from the matrix rather than written out, so recovering a kind from a
 * rendered message stays tied to the wording that produced it.
 */
const REASON_PREFIXES: ReadonlyArray<readonly [SzFallbackKind, string]> = SZ_FALLBACK_KINDS.map(
    kind =>
        [kind, SZ_FALLBACK_MATRIX[kind].reason.split(SZ_FALLBACK_DETAIL_PLACEHOLDER)[0]] as const,
);

/**
 * Recover which kind produced a rendered reason.
 *
 * @param message - One raw diagnostic line, site label included.
 * @returns The kind, or undefined when the reason matches no matrix entry.
 */
function szFallbackKindOf(message: string): SzFallbackKind | undefined {
    // The position (`1:1`) carries a colon of its own but never a space, so
    // the first colon-space is the boundary between it and the reason.
    const boundary = message.indexOf(': ');
    if (boundary === -1) return undefined;
    const reason = message.slice(boundary + 2);
    for (const [kind, prefix] of REASON_PREFIXES) {
        if (reason.startsWith(prefix)) return kind;
    }
    return undefined;
}

/**
 * Classify a rendered diagnostic back to its consequence.
 *
 * Owned by the module that RENDERS the labels, so routing built on this
 * cannot drift from the wording the way an inlined substring match would —
 * change a label above and this classifier changes with it. (Structured
 * diagnostic fields across the three engines are the fuller answer; until
 * that contract exists, the classifier is the single point of coupling.)
 *
 * @param message - One raw diagnostic line as an engine emitted it.
 * @returns The consequence, or undefined for messages outside the matrix.
 */
export function szFallbackConsequenceOf(message: string): SzFallbackConsequence | undefined {
    for (const site of Object.keys(SITE_LABEL) as SzFallbackSite[]) {
        if (message.startsWith(`${SITE_LABEL[site]} at `)) {
            if (site !== 'sz') return 'missing-css';
            const kind = szFallbackKindOf(message);
            // An unreadable reason falls to the advisory side on purpose: a
            // parsing miss must not be able to invent a production error.
            return kind !== undefined && SZ_SITE_MISSING_CSS_KINDS.has(kind)
                ? 'missing-css'
                : 'nudge';
        }
    }
    // szs renders through its own builder; an unresolved slot map means no
    // slot classes were compiled, which is the same absent-CSS failure.
    if (message.startsWith('[csszyx] szs at ')) {
        return 'missing-css';
    }
    return undefined;
}

/** What went wrong, for {@link szsUnsupportedDiagnostic}. */
const SZS_REASON =
    'a slot value could not be read at build time, so no slot classes were compiled.';

/**
 * The `szs` slot-map diagnostic, in full.
 *
 * Its own builder rather than a site of {@link formatSzFallbackDiagnostic}:
 * the advice does not vary by expression kind (the szs contract is that every
 * slot resolves at build time, so the fix is the same whatever shape broke it),
 * and every engine reports it against the filename rather than a position.
 *
 * @param filename - Source file, as each engine names it.
 * @returns The diagnostic text.
 */
export function szsUnsupportedDiagnostic(filename: string): string {
    return (
        `[csszyx] szs at ${filename}: ${SZS_REASON} Attribute left unchanged.` +
        `\n  Suggestion: ${SZ_FALLBACK_SZS_SUGGESTION}`
    );
}

/**
 * Render one complete diagnostic line for a construct that could not be
 * resolved at build time.
 *
 * Every engine formats through this, so a `build.parser` flip cannot change the
 * wording, and the four call sites cannot drift from each other.
 *
 * @param site - Which construct hit the failure.
 * @param position - `line:column`, 1-based, as the JS lanes report it.
 * @param kind - Classified shape of the unresolved expression.
 * @param detail - Callee name, identifier name, or node type.
 * @returns The diagnostic text, reason and suggestion included.
 */
export function formatSzFallbackDiagnostic(
    site: SzFallbackSite,
    position: string,
    kind: SzFallbackKind,
    detail = '',
): string {
    const { reason, suggestion } = describeSzFallback(kind, detail);
    const advice = site === 'szv' ? SZ_FALLBACK_SZV_SUGGESTION : suggestion;
    return `${SITE_LABEL[site]} at ${position}: ${reason}.\n  Suggestion: ${advice}`;
}
