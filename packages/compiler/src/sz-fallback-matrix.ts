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
