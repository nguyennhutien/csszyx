/**
 * Visitor-side helpers for the szRecover hydration safety system.
 *
 * The compiler also re-exports a public-API recovery surface from
 * `recovery.ts` + `manifest.ts` (`generateRecoveryToken`,
 * `ManifestBuilder`, `TokenData`, etc.). Those are the verbose
 * variants — they take a full `TokenMetadata` (filePath/line/column/buildId).
 *
 * This module is the THIN INLINE variant used by the JSX-attribute
 * visitor: positional args, no buildId, deterministic across rebuilds.
 * Kept private to the compiler package — `transform.ts` calls these
 * directly and never re-exports them, so callers of `@csszyx/compiler`
 * still see only the public-API surface.
 *
 * Build-time only — uses `node:crypto`. The browser-safe compiler
 * subpath (`@csszyx/compiler/browser`) does not load this file.
 */

import { createHash } from 'node:crypto';

import type { RecoveryMode } from './recovery.js';

/**
 * Deterministic 12-character token from the JSX element's identity:
 * `SHA-256(filename:line:column:elementType)` truncated to 12 hex chars.
 *
 * 12 hex chars = 48 bits ≈ 281 trillion distinct values. For a single
 * build with even tens of thousands of recovery sites, collision is
 * statistically negligible and the deterministic input means re-running
 * the build (e.g. HMR) regenerates the same tokens.
 *
 * Different from the public `generateRecoveryToken` in `recovery.ts` —
 * that variant folds buildId into the hash so tokens differ across
 * builds. The visitor wants stable tokens (HMR friendliness); the
 * manifest's own buildId field already provides per-build uniqueness.
 *
 * @param filename Source file path the JSX element appears in.
 * @param line 1-based line number of the JSX element.
 * @param column 0-based column of the JSX element.
 * @param elementType JSX element type, e.g. `'div'`, `'MyComponent'`.
 * @returns 12-character lowercase hex token.
 */
export function generateInlineRecoveryToken(
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
export function isValidInlineRecoveryMode(value: unknown): value is RecoveryMode {
    return value === 'csr' || value === 'dev-only';
}
