/**
 * Recovery token generation for the szRecover hydration safety system.
 *
 * The runtime side (`@csszyx/runtime/verify`) reads tokens from a manifest
 * embedded in the SSR HTML and matches them against `data-sz-recovery-token`
 * attributes on hydrated elements. Without a build-side emitter, every
 * verifyRecoveryToken() call rejects — that's the half-shipped state this
 * module fixes.
 *
 * This file is build-time only. It uses `node:crypto`, which is unavailable
 * in browser builds — the browser-safe compiler entry (`@csszyx/compiler/browser`)
 * imports from `transform-core.ts`, NOT from this file.
 */

import { createHash } from 'node:crypto';

/**
 * Two recovery modes recognized by the runtime:
 *
 * - `csr`: server-rendered subtree may fall back to client-side rendering
 *   if hydration mismatches. Token must exist in manifest for runtime to
 *   accept the recovery.
 * - `dev-only`: recovery is allowed only in development. Production builds
 *   that include `dev-only` tokens trigger a parity warning.
 */
export type RecoveryMode = 'csr' | 'dev-only';

/**
 * One entry in the manifest's `tokens` map. Mirrors the shape consumed by
 * `@csszyx/runtime/verify`'s `RecoveryManifest.tokens[token]`.
 */
export interface RecoveryTokenData {
    /** Recovery semantics — must match the element's `szRecover` attribute. */
    mode: RecoveryMode;
    /**
     * JSX element type at the declaration site, e.g. `'div'`, `'Button'`.
     * Used by the runtime for human-readable error messages.
     */
    component: string;
    /**
     * Source path the token was emitted from, e.g.
     * `src/pages/Home.tsx:12:8`. The format is `${filename}:${line}:${col}`,
     * giving devtools a click-through location.
     */
    path: string;
}

/**
 * Deterministic 12-character token from the JSX element's identity:
 * `SHA-256(filename:line:column:elementType)` truncated to 12 hex chars.
 *
 * 12 hex chars = 48 bits ≈ 281 trillion distinct values. For a single
 * build with even tens of thousands of recovery sites, collision is
 * statistically negligible and the deterministic input means re-running
 * the build (e.g. HMR) regenerates the same tokens.
 *
 * @param filename Source file path the JSX element appears in.
 * @param line 1-based line number of the JSX element.
 * @param column 0-based column of the JSX element.
 * @param elementType JSX element type, e.g. `'div'`, `'MyComponent'`.
 * @returns 12-character lowercase hex token.
 */
export function generateRecoveryToken(
    filename: string,
    line: number,
    column: number,
    elementType: string,
): string {
    const input = `${filename}:${line}:${column}:${elementType}`;
    return createHash('sha256').update(input).digest('hex').substring(0, 12);
}

/**
 * Type guard for the `szRecover` attribute value. Anything other than the
 * two literal modes is treated as an authoring mistake — the visitor
 * skips token emission for invalid values (rather than guessing).
 *
 * @param value Raw `szRecover` attribute value pulled from the AST.
 * @returns True when value is one of the two recognised modes.
 */
export function isValidRecoveryMode(value: unknown): value is RecoveryMode {
    return value === 'csr' || value === 'dev-only';
}
