/**
 * Linear scans for `@csszyx/runtime` helper imports.
 *
 * The import-injection passes need to answer "does this module already import
 * helper X from '@csszyx/runtime'?" and "where is its existing import clause?".
 * The previous regexes (`\{[^{}]*\bNAME\b[^{}]*\}`) had two open `[^{}]*` runs
 * around the needle, which a coverage-guided ReDoS checker (recheck) reports as
 * quadratic-by-search: on a long clause with no closing brace the match retries
 * from each position. These helpers do a single forward pass instead.
 *
 * @module
 */

/**
 * Matches one `import|export { … } from '@csszyx/runtime'` clause with a
 * SINGLE bounded group. One `[^{}]*` between literal braces is linear (verified
 * safe by recheck); the quadratic form only appeared when a second open run sat
 * on the other side of an inner needle.
 */
const RUNTIME_IMPORT_CLAUSE_RE =
    /(?:import|export)\s+\{([^{}]*)\}\s*from\s*['"]@csszyx\/runtime['"]/g;

/**
 * Split an import clause body into its imported names. An import clause is
 * comma-separated specifiers; the imported (outer) name of `a as b` is `a`.
 *
 * @param clauseBody - The text between the `{` and `}` of an import clause.
 * @returns The imported names in the clause.
 */
function clauseNames(clauseBody: string): string[] {
    const names: string[] = [];
    for (const part of clauseBody.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) {
            continue;
        }
        // `name` or `name as alias` — the bound-to name is the first token.
        // A single split of a short specifier is linear.
        const spaceAt = trimmed.search(/\s/);
        names.push(spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt));
    }
    return names;
}

/**
 * Whether `code` already imports (or re-exports) `helper` from
 * `@csszyx/runtime`. Exact-name equivalent of the old
 * `\bHELPER\b`-in-clause regex — `_sz` never matches inside `_szMerge` or
 * `__szColorVar` there (no word boundary), and exact comparison agrees.
 *
 * @param code - Module source.
 * @param helper - Helper name to look for.
 * @returns True when the helper is imported from `@csszyx/runtime`.
 */
export function importsRuntimeHelper(code: string, helper: string): boolean {
    RUNTIME_IMPORT_CLAUSE_RE.lastIndex = 0;
    for (
        let match = RUNTIME_IMPORT_CLAUSE_RE.exec(code);
        match;
        match = RUNTIME_IMPORT_CLAUSE_RE.exec(code)
    ) {
        if (clauseNames(match[1]).includes(helper)) {
            return true;
        }
    }
    return false;
}

/**
 * Import-only clause (no re-export), capturing the prefix-plus-body so the
 * append site can reconstruct byte-identically. `[^{}]*` here is the same safe
 * single-run shape; import-only because you cannot append named imports onto an
 * `export … from`.
 */
const RUNTIME_IMPORT_APPEND_RE = /(import\s+\{[^{}]*)\}\s*from\s*['"]@csszyx\/runtime['"]/;

/** A located `import { … } from '@csszyx/runtime'` statement to append onto. */
export interface RuntimeImportClause {
    /** The full matched statement text (the search target for replacement). */
    readonly statement: string;
    /** `import { <body>` — everything up to but not including the `}`. */
    readonly prefixWithBody: string;
}

/**
 * Find the first `import { … } from '@csszyx/runtime'` statement (import only,
 * not re-export), for appending new named imports onto. Linear replacement for
 * `^(import\s*\{[^}]*)\}\s*from\s*'…'/m`, whose `[^}]*` re-scanned from each
 * line start under the `m` flag.
 *
 * @param code - Module source.
 * @returns The located clause, or null when no such import exists.
 */
export function findRuntimeImportClause(code: string): RuntimeImportClause | null {
    const match = RUNTIME_IMPORT_APPEND_RE.exec(code);
    return match ? { statement: match[0], prefixWithBody: match[1] } : null;
}
