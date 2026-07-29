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
