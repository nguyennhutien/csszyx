/**
 * Phase D production skeleton — `transformOxc()` will eventually replace
 * `transformSourceCode()` (Babel) as the compiler's parse-and-rewrite
 * entry point. Right now this file is a typed skeleton: the function
 * signature mirrors `transformSourceCode`'s return shape so the parity
 * harness in `tests/oxc-parity-harness.ts` can compare both
 * implementations side-by-side as D2.1+ slices land.
 *
 * Until D2.1 fills in the real implementation, calling `transformOxc`
 * throws `OxcNotImplementedError`. The parity harness expects this for
 * any fixture marked `expected: 'pending'`, so the test suite stays
 * green while parity grows incrementally.
 *
 * See `.agent/workflows/future-roadmap.md` § Phase D for the
 * multi-slice migration plan (D1 foundation → D2 port → D3 test parity
 * → D4 flag swap → D5 hoisting → D6 browser sub-path → D7 default flip).
 */

import type { TokenData } from './manifest.js';
import type { TransformSourceCodeOptions } from './transform.js';

/**
 * Result shape returned by both `transformSourceCode` (Babel) and the
 * future `transformOxc`. Kept in lock-step so the parity harness can
 * diff results without conditional logic.
 */
export interface TransformOxcResult {
    /** Rewritten source — equal to input when `transformed === false`. */
    code: string;
    /** True when at least one sz/szRecover/_sz mutation was applied. */
    transformed: boolean;
    /** Did the file pull in `_sz` runtime helper? */
    usesRuntime: boolean;
    /** Did the file pull in `_szMerge` runtime helper? */
    usesMerge: boolean;
    /** Did the file use color-var helpers? */
    usesColorVar: boolean;
    /** Class names emitted by the compiler — drives the mangle map. */
    classes: Set<string>;
    /** Hand-written `className="..."` strings — TW JIT safelist only. */
    rawClassNames: Set<string>;
    /** Dev-mode warnings emitted during transform. */
    diagnostics: string[];
    /** Recovery tokens emitted by szRecover attributes. */
    recoveryTokens: Map<string, TokenData>;
}

/**
 * Thrown when a caller hits the skeleton before D2.1+ implements the
 * matching path. The harness catches this and reports the fixture as
 * `pending` rather than failing the suite.
 */
export class OxcNotImplementedError extends Error {
    /**
     * @param slice The Phase D slice expected to implement this path.
     * @param detail What the caller asked for that is not yet wired.
     */
    constructor(slice: string, detail: string) {
        super(`transformOxc: ${slice} not implemented yet — ${detail}`);
        this.name = 'OxcNotImplementedError';
    }
}

/**
 * Transform a TSX/JSX source string using oxc-parser + magic-string.
 *
 * **Status:** skeleton. Throws {@link OxcNotImplementedError} until D2.1
 * lands the read-only class-extraction path. Each subsequent slice
 * (D2.2 rewrite, D2.3 szRecover, …) widens the set of fixtures that
 * succeed without throwing.
 *
 * @param _source The source code to transform (unused in skeleton).
 * @param _filename Optional filename, drives JSX detection (unused in skeleton).
 * @param _options Optional overrides such as `astBudget` (unused in skeleton).
 * @returns Transform result matching {@link TransformOxcResult}.
 * @throws {OxcNotImplementedError} until the matching slice lands.
 */
export function transformOxc(
    _source: string,
    _filename?: string,
    _options?: TransformSourceCodeOptions,
): TransformOxcResult {
    throw new OxcNotImplementedError(
        'D2.1',
        'real parse-and-extract path is not wired yet — only the skeleton exists for the parity harness',
    );
}
