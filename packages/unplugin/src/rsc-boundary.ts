import * as fs from 'node:fs';
import * as path from 'node:path';

import { normalizePathSeparators } from './path-normalization.js';

const SERVER_DIRECTIVE_RE = /^['"]use server['"];?$/;
const CLIENT_DIRECTIVE_RE = /^['"]use client['"];?$/;

const RUNTIME_HELPER_MODULES = new Set([
    '@csszyx/runtime',
    '@csszyx/runtime/lite',
    'csszyx',
    'csszyx/lite',
]);

const CLIENT_RUNTIME_MODULES = new Set(['csszyx/browser']);

const CLIENT_RUNTIME_MODULE_ROOTS = ['@csszyx/dynamic', 'csszyx/dynamic'];

const normalizedModuleIdCache = new Map<string, string>();
const resolvedLocalModuleCache = new Map<string, string>();

const FORBIDDEN_SYMBOLS = new Set(['_sz', '_sz2', '_sz3', '_szMerge', '__csszyx_runtime__']);

/**
 * Direct RSC boundary violation found in a transformed module.
 */
export interface RSCBoundaryViolation {
    /** Forbidden runtime helper that crossed into an RSC server module. */
    symbol: string;
    /** Server module path where the import was found. */
    path: string;
    /** Import chain used in the fatal build error. */
    importChain: string[];
}

/**
 * RSC module metadata collected during the transform phase.
 */
export interface RSCModuleRecord {
    /** Normalized absolute module ID. */
    id: string;
    /** True when this module is an RSC server module entry or has `'use server'`. */
    isServer: boolean;
    /** True when this module declares the client boundary. */
    isClient: boolean;
    /** Local modules imported by this file after path resolution. */
    imports: string[];
    /** Forbidden runtime imports found directly in this module. */
    runtimeImports: Array<{ source: string; symbols: string[] }>;
}

/**
 * Returns true when a module starts with the top-level `'use server'`
 * directive. Comments and blank lines before the directive are allowed, but
 * detection stops at the first real statement.
 *
 * @param code module source
 * @returns true when the module has a top-level `'use server'` directive
 */
export function hasUseServerDirective(code: string): boolean {
    for (const statement of readDirectivePrologue(code)) {
        if (SERVER_DIRECTIVE_RE.test(statement)) {
            return true;
        }
        if (CLIENT_DIRECTIVE_RE.test(statement)) {
            return false;
        }
    }
    return false;
}

/**
 * Returns true when a module starts with the top-level `'use client'`
 * directive.
 *
 * @param code module source
 * @returns true when the module has a top-level `'use client'` directive
 */
export function hasUseClientDirective(code: string): boolean {
    for (const statement of readDirectivePrologue(code)) {
        if (CLIENT_DIRECTIVE_RE.test(statement)) {
            return true;
        }
        if (SERVER_DIRECTIVE_RE.test(statement)) {
            return false;
        }
    }
    return false;
}

/**
 * Detects modules that should be treated as RSC server modules by csszyx.
 *
 * @param code module source
 * @param id module ID/path
 * @returns true when the module is server-side for RSC boundary purposes
 */
export function isRSCServerModule(code: string, id: string): boolean {
    if (hasUseServerDirective(code)) {
        return true;
    }
    if (hasUseClientDirective(code)) {
        return false;
    }
    return isNextAppRouterEntry(id);
}

/**
 * Finds the first direct forbidden runtime helper import in an RSC server
 * module.
 *
 * @param code module source
 * @param id module ID/path
 * @returns violation details, or null when the module is allowed
 */
export function findRSCBoundaryViolation(code: string, id: string): RSCBoundaryViolation | null {
    if (!isRSCServerModule(code, id)) {
        return null;
    }

    for (const imported of findRuntimeImports(code)) {
        for (const symbol of imported.symbols) {
            if (FORBIDDEN_SYMBOLS.has(symbol)) {
                return {
                    symbol,
                    path: id,
                    importChain: [id, imported.source],
                };
            }
        }
    }

    return null;
}

/**
 * Builds module metadata for the RSC graph walker.
 *
 * @param code module source
 * @param id module ID/path
 * @returns graph metadata for the module
 */
export function createRSCModuleRecord(code: string, id: string): RSCModuleRecord {
    const normalized = normalizeModuleId(id);
    return {
        id: normalized,
        isServer: isRSCServerModule(code, normalized),
        isClient: hasUseClientDirective(code),
        imports: findLocalImportSources(code)
            .map(source => resolveLocalModule(normalized, source))
            .filter((resolved): resolved is string => resolved !== null),
        runtimeImports: findRuntimeImports(code).filter(imported =>
            imported.symbols.some(symbol => FORBIDDEN_SYMBOLS.has(symbol)),
        ),
    };
}

/**
 * Removes a module record after the bundler watcher reports that the file was
 * deleted.
 *
 * @param records module graph records keyed by normalized module ID
 * @param id module ID/path from the watcher event
 * @returns true when a stale record was removed
 */
export function deleteRSCModuleRecord(records: Map<string, RSCModuleRecord>, id: string): boolean {
    const normalized = normalizeModuleId(id);
    const clean = normalizePathSeparators(id.split('?')[0] ?? id);
    const resolved = normalizePathSeparators(path.resolve(clean));
    pruneRSCModulePathCaches(new Set([normalized, resolved, clean]));

    let deleted = records.delete(normalized);
    if (resolved !== normalized) {
        deleted = records.delete(resolved) || deleted;
    }
    if (clean !== normalized && clean !== resolved) {
        deleted = records.delete(clean) || deleted;
    }
    return deleted;
}

/**
 * Finds forbidden runtime helper imports reachable from an RSC server module.
 * Traversal stops at `'use client'` modules because they define a separate
 * client module graph.
 *
 * @param records module graph records keyed by normalized module ID
 * @returns first graph violation, or null when the graph is allowed
 */
export function findRSCGraphViolation(
    records: Map<string, RSCModuleRecord>,
): RSCBoundaryViolation | null {
    for (const root of records.values()) {
        if (!root.isServer) {
            continue;
        }
        const violation = walkRSCGraph(root, records, [root.id], new Set([root.id]));
        if (violation) {
            return {
                symbol: violation.symbol,
                path: root.id,
                importChain: violation.importChain,
            };
        }
    }

    return null;
}

/**
 * Throws the spec-format fatal RSC boundary error for graph-level violations.
 *
 * @param records module graph records keyed by normalized module ID
 */
export function assertNoRSCGraphViolation(records: Map<string, RSCModuleRecord>): void {
    const violation = findRSCGraphViolation(records);
    if (!violation) {
        return;
    }

    throw new Error(formatRSCViolation(violation));
}

/**
 * Detects Next App Router route entry files that are Server Components unless
 * they opt into `'use client'`.
 *
 * @param id module ID/path
 * @returns true for supported Next App Router route entry filenames
 */
const APP_ROUTER_ENTRIES = new Set([
    'page',
    'layout',
    'template',
    'loading',
    'error',
    'not-found',
    'global-error',
    'default',
    'route',
]);

/**
 * @param id - module ID/path
 * @returns true for supported Next App Router route entry filenames
 */
function isNextAppRouterEntry(id: string): boolean {
    const clean = normalizePathSeparators(id.split('?')[0] ?? id);
    if (!clean.includes('/app/') && !clean.startsWith('app/')) return false;
    const basename = clean.split('/').pop() ?? '';
    const dotIdx = basename.indexOf('.');
    if (dotIdx === -1) return false;
    const stem = basename.slice(0, dotIdx);
    const ext = basename.slice(dotIdx + 1);
    return APP_ROUTER_ENTRIES.has(stem) && /^[cm]?[tj]sx?$/.test(ext);
}

/**
 * Throws the spec-format fatal RSC boundary error when a server module imports
 * a forbidden csszyx runtime helper.
 *
 * @param code module source
 * @param id module ID/path
 */
export function assertNoRSCBoundaryViolation(code: string, id: string): void {
    const violation = findRSCBoundaryViolation(code, id);
    if (!violation) {
        return;
    }

    throw new Error(formatRSCViolation(violation));
}

/**
 * Formats a violation using the public spec error shape.
 *
 * @param violation violation details
 * @returns fatal build error message
 */
function formatRSCViolation(violation: RSCBoundaryViolation): string {
    return (
        `csszyxRSCViolation: ${violation.symbol} imported in Server Component ${violation.path}\n` +
        `  Import chain: ${violation.importChain.join(' -> ')}`
    );
}

/**
 * Walks server-owned imports until a forbidden runtime helper is found.
 *
 * @param current current module record
 * @param records graph records keyed by module ID
 * @param chain import chain from the root server module to current
 * @param seen visited module IDs for cycle protection
 * @returns first violation discovered below current
 */
function walkRSCGraph(
    current: RSCModuleRecord,
    records: Map<string, RSCModuleRecord>,
    chain: string[],
    seen: Set<string>,
): RSCBoundaryViolation | null {
    if (current.isClient) {
        return null;
    }

    const runtime = current.runtimeImports[0];
    const symbol = runtime?.symbols.find(s => FORBIDDEN_SYMBOLS.has(s));
    if (runtime && symbol) {
        return {
            symbol,
            path: chain[0] ?? current.id,
            importChain: [...chain, runtime.source],
        };
    }

    for (const importedId of current.imports) {
        if (seen.has(importedId)) {
            continue;
        }
        const next = records.get(importedId);
        if (!next) {
            continue;
        }
        seen.add(importedId);
        const violation = walkRSCGraph(next, records, [...chain, importedId], seen);
        if (violation) {
            return violation;
        }
    }

    return null;
}

/**
 * Find the closing quote for one directive literal.
 *
 * @param code Module source.
 * @param start Opening-quote offset.
 * @param quote Directive quote style.
 * @returns Closing-quote offset, or -1 when unterminated.
 */
function findDirectiveQuoteEnd(code: string, start: number, quote: string): number {
    let escaped = false;
    for (let index = start + 1; index < code.length; index++) {
        const char = code[index];
        if (escaped) {
            escaped = false;
        } else if (char === '\\') {
            escaped = true;
        } else if (char === quote) {
            return index;
        }
    }
    return -1;
}

/**
 * Consume whitespace and an optional semicolon after a directive literal.
 *
 * @param code Module source.
 * @param start Offset immediately after the closing quote.
 * @returns Offset immediately after the directive statement.
 */
function findDirectiveStatementEnd(code: string, start: number): number {
    let end = start;
    while (end < code.length && /[ \t\r\n]/.test(code[end])) {
        end++;
    }
    return code[end] === ';' ? end + 1 : end;
}

/**
 * Reads the top-level directive prologue without requiring a full parser.
 *
 * @param code module source
 * @returns normalized directive statements
 */
function readDirectivePrologue(code: string): string[] {
    const out: string[] = [];
    let i = readCodePoint(code, 0) === 0xfeff ? 1 : 0;

    while (i < code.length) {
        i = skipWhitespaceAndComments(code, i);
        const quote = code[i];
        if (quote !== '"' && quote !== "'") {
            break;
        }

        const quoteEnd = findDirectiveQuoteEnd(code, i, quote);
        if (quoteEnd === -1) {
            break;
        }
        const end = findDirectiveStatementEnd(code, quoteEnd + 1);
        out.push(code.slice(i, end).trim());
        i = end;
    }

    return out;
}

/**
 * Advances over whitespace and comments while reading the directive prologue.
 *
 * @param code module source
 * @param start starting offset
 * @returns first non-whitespace/comment offset
 */
function skipWhitespaceAndComments(code: string, start: number): number {
    let i = start;
    while (i < code.length) {
        while (i < code.length && /\s/.test(code[i])) {
            i++;
        }
        if (code.startsWith('//', i)) {
            const next = code.indexOf('\n', i + 2);
            i = next === -1 ? code.length : next + 1;
            continue;
        }
        if (code.startsWith('/*', i)) {
            const next = code.indexOf('*/', i + 2);
            i = next === -1 ? code.length : next + 2;
            continue;
        }
        break;
    }
    return i;
}

/**
 * Finds static and dynamic imports from csszyx runtime entrypoints.
 *
 * @param code module source
 * @returns runtime import sources and imported symbols
 */
function findRuntimeImports(code: string): Array<{ source: string; symbols: string[] }> {
    const imports: Array<{ source: string; symbols: string[] }> = [];
    const scanCode = stripCommentsForImportScan(code);
    const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (const { clause, source } of findStaticImports(scanCode)) {
        if (!isRuntimeImportSource(source)) {
            continue;
        }
        if (clause === null) {
            imports.push({
                source,
                symbols: isWholeRuntimeModuleForbidden(source) ? Array.from(FORBIDDEN_SYMBOLS) : [],
            });
        } else {
            imports.push({ source, symbols: readRuntimeImportSymbols(source, clause) });
        }
    }

    for (const match of scanCode.matchAll(dynamicImportRe)) {
        const source = match[1];
        if (isRuntimeImportSource(source)) {
            imports.push({ source, symbols: Array.from(FORBIDDEN_SYMBOLS) });
        }
    }

    return imports;
}

/**
 * Static import clause and module source.
 */
interface StaticImport {
    clause: string | null;
    source: string;
}

/** Result of scanning one import keyword. */
interface StaticImportScanResult {
    nextCursor: number;
    value?: StaticImport;
}

/**
 * Finds static imports with a linear lexical scan that supports multiline clauses.
 *
 * @param code Module source with comments removed.
 * @returns Discovered static imports.
 */
function findStaticImports(code: string): StaticImport[] {
    const imports: StaticImport[] = [];
    let cursor = 0;
    while (cursor < code.length) {
        const importStart = code.indexOf('import', cursor);
        if (importStart === -1) break;
        const result = scanStaticImport(code, importStart);
        cursor = result.nextCursor;
        if (result.value) imports.push(result.value);
    }
    return imports;
}

/**
 * Scans one import keyword and separates static imports from dynamic calls.
 *
 * @param code - Module source with comments removed.
 * @param importStart - Offset of the import keyword.
 * @returns Next scan cursor and an optional static import.
 */
function scanStaticImport(code: string, importStart: number): StaticImportScanResult {
    const afterKeyword = importStart + 6;
    if (
        (importStart > 0 && isIdentifierPart(readCodePoint(code, importStart - 1))) ||
        isIdentifierPart(readCodePoint(code, afterKeyword))
    ) {
        return { nextCursor: afterKeyword };
    }

    const clauseStart = skipAsciiWhitespace(code, afterKeyword);
    const opener = code.charAt(clauseStart);
    if (opener === '(') return { nextCursor: afterKeyword };
    if (opener === '"' || opener === "'") {
        return scanSideEffectImport(code, clauseStart, afterKeyword);
    }
    return scanImportClause(code, clauseStart, afterKeyword);
}

/**
 * Reads a side-effect-only static import.
 *
 * @param code - Module source.
 * @param literalStart - Opening quote offset.
 * @param fallbackCursor - Cursor used for a malformed literal.
 * @returns Import scan result.
 */
function scanSideEffectImport(
    code: string,
    literalStart: number,
    fallbackCursor: number,
): StaticImportScanResult {
    const literal = readQuotedString(code, literalStart);
    return literal
        ? { nextCursor: literal.end, value: { clause: null, source: literal.value } }
        : { nextCursor: fallbackCursor };
}

/**
 * Reads a static import clause and its source literal.
 *
 * @param code - Module source.
 * @param clauseStart - First non-whitespace offset after import.
 * @param fallbackCursor - Cursor used when the clause is incomplete.
 * @returns Import scan result.
 */
function scanImportClause(
    code: string,
    clauseStart: number,
    fallbackCursor: number,
): StaticImportScanResult {
    const fromStart = findImportFromKeyword(code, clauseStart);
    if (fromStart === -1) return { nextCursor: fallbackCursor };

    const clause = code.slice(clauseStart, fromStart).trim();
    if (splitAsciiWhitespace(clause)[0] === 'type') {
        return { nextCursor: fromStart + 4 };
    }

    const literalStart = skipAsciiWhitespace(code, fromStart + 4);
    const literal = readQuotedString(code, literalStart);
    return literal
        ? { nextCursor: literal.end, value: { clause, source: literal.value } }
        : { nextCursor: fallbackCursor };
}

/**
 * Finds the standalone `from` keyword before an import terminator.
 *
 * @param code - Module source.
 * @param clauseStart - Import clause start offset.
 * @returns Keyword offset, or -1 when absent.
 */
function findImportFromKeyword(code: string, clauseStart: number): number {
    for (let position = clauseStart; position < code.length; position += 1) {
        if (code.charAt(position) === ';') return -1;
        if (
            code.startsWith('from', position) &&
            (position === clauseStart || !isIdentifierPart(readCodePoint(code, position - 1))) &&
            !isIdentifierPart(readCodePoint(code, position + 4))
        ) {
            return position;
        }
    }
    return -1;
}

/**
 * Reads a single- or double-quoted JavaScript string literal.
 *
 * @param code Module source.
 * @param start Opening quote offset.
 * @returns Decoded string and ending offset, or null when malformed.
 */
function readQuotedString(code: string, start: number): { end: number; value: string } | null {
    const quote = code.charAt(start);
    if (quote !== '"' && quote !== "'") {
        return null;
    }
    let value = '';
    for (let index = start + 1; index < code.length; index += 1) {
        const char = code.charAt(index);
        if (char === '\\') {
            if (index + 1 >= code.length) {
                return null;
            }
            value += code.charAt(index + 1);
            index += 1;
        } else if (char === quote) {
            return { end: index + 1, value };
        } else if (char === '\n' || char === '\r') {
            return null;
        } else {
            value += char;
        }
    }
    return null;
}

/**
 * Advances past JavaScript ASCII whitespace.
 *
 * @param code Module source.
 * @param start Initial offset.
 * @returns First non-whitespace offset.
 */
function skipAsciiWhitespace(code: string, start: number): number {
    let index = start;
    while (index < code.length) {
        const charCode = readCodePoint(code, index);
        if (charCode !== 9 && charCode !== 10 && charCode !== 13 && charCode !== 32) {
            break;
        }
        index += 1;
    }
    return index;
}

/**
 * Returns whether a character code can continue an ASCII identifier.
 *
 * @param code Character code.
 * @returns Whether the character can continue an identifier.
 */
function isIdentifierPart(code: number): boolean {
    return isIdentifierStart(code) || (code >= 48 && code <= 57);
}

/**
 * Returns true for csszyx runtime entrypoints that cannot cross into an RSC
 * server module.
 *
 * @param source import source
 * @returns true when the source is a csszyx runtime module
 */
function isRuntimeImportSource(source: string): boolean {
    return (
        RUNTIME_HELPER_MODULES.has(source) ||
        source.startsWith('@csszyx/runtime/') ||
        CLIENT_RUNTIME_MODULES.has(source) ||
        CLIENT_RUNTIME_MODULE_ROOTS.some(root => source === root || source.startsWith(`${root}/`))
    );
}

/**
 * Some runtime entrypoints are client-only APIs where any import form is
 * unsafe, even when the imported name is not one of the generated helpers.
 *
 * @param source import source
 * @returns true when every import from this source is forbidden
 */
function isWholeRuntimeModuleForbidden(source: string): boolean {
    return (
        source.startsWith('@csszyx/runtime/') ||
        CLIENT_RUNTIME_MODULES.has(source) ||
        CLIENT_RUNTIME_MODULE_ROOTS.some(root => source === root || source.startsWith(`${root}/`))
    );
}

/**
 * Reads the symbols to enforce for a runtime import source.
 *
 * @param source import source
 * @param clause static import clause
 * @returns imported symbols relevant to the RSC guard
 */
function readRuntimeImportSymbols(source: string, clause: string): string[] {
    if (isWholeRuntimeModuleForbidden(source)) {
        return Array.from(FORBIDDEN_SYMBOLS);
    }
    return readImportedSymbols(clause);
}

/**
 * Finds relative static, re-export, and dynamic imports.
 *
 * @param code module source
 * @returns local import specifiers
 */
/**
 * Extract relative/absolute local module specifiers from `code`. Exported for
 * the linear-scan equivalence test; the module graph consumes it via
 * {@link createRSCModuleRecord}.
 *
 * @param code - Module source.
 * @returns Local (`.`/`/`) import specifiers, in the legacy pass order.
 */
export function findLocalImportSources(code: string): string[] {
    const out: string[] = [];
    // Static `import … '<spec>'` and `export … from '<spec>'` are line-scoped:
    // the old regexes used `.`, which never crosses a newline. Scanning each
    // line with indexOf keeps that scope while dropping the `\S(?:.*\S)?` run
    // that made the regexes quadratic-by-search. Order (all static, then all
    // export) matches the previous two-regex pass.
    //
    // Behaviour is identical for the universal one-statement-per-line case. For
    // the rare (formatter-discouraged) multiple-imports-on-one-line case, the
    // old greedy `.*` collapsed them into a single match anchored on the LAST
    // `from`, silently dropping the earlier specifiers; this scanner reports
    // every one. That is the safe direction for the dependency graph — it can
    // only ever find MORE edges, never miss one the old code caught.
    for (const line of code.split('\n')) {
        for (const spec of staticImportSpecifiers(line)) {
            pushIfLocal(out, spec);
        }
    }
    for (const line of code.split('\n')) {
        for (const spec of exportFromSpecifiers(line)) {
            pushIfLocal(out, spec);
        }
    }
    // Dynamic `import( '<spec>' )` can span lines; this regex has no open run
    // and is already linear.
    for (const match of code.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        pushIfLocal(out, match[1]);
    }
    return out;
}

/**
 * Push `spec` when it is a relative/absolute local specifier.
 *
 * @param out - Accumulator.
 * @param spec - A module specifier, or null to skip.
 */
function pushIfLocal(out: string[], spec: string | null): void {
    if (spec !== null && (spec.startsWith('.') || spec.startsWith('/'))) {
        out.push(spec);
    }
}

/**
 * Every quoted specifier from `import` statements on a single line, matching
 * `import\s+(?!type\b)(?:\S(?:.*\S)?\s+from\s+)?['"]([^'"]+)['"]/g`: side-effect
 * `import '<spec>'` or `import … from '<spec>'`, but never `import type …`. The
 * old regex had no leading word boundary, so this keys only on `import` being
 * followed by whitespace (the `\s+`), not on the character before it.
 *
 * @param line - One source line (no newline).
 * @returns The specifiers, in order of appearance.
 */
function staticImportSpecifiers(line: string): string[] {
    const specs: string[] = [];
    for (const kw of allOccurrences(line, 'import')) {
        const afterKw = skipSpaces(line, kw + 'import'.length);
        // `import` must be followed by whitespace (\s+) then a non-`type` token.
        if (afterKw === kw + 'import'.length || startsWithWord(line, afterKw, 'type')) {
            continue;
        }
        // Side-effect form: a quote immediately follows `import `.
        if (line[afterKw] === '"' || line[afterKw] === "'") {
            const spec = readQuoted(line, afterKw);
            if (spec !== null) {
                specs.push(spec);
            }
            continue;
        }
        // Clause form: `import <clause> from '<spec>'`.
        const spec = specifierAfterFrom(line, afterKw);
        if (spec !== null) {
            specs.push(spec);
        }
    }
    return specs;
}

/**
 * Every quoted specifier from `export … from` statements on a single line,
 * matching `export\s+(?!type\b)\S(?:.*\S)?\s+from\s+['"]([^'"]+)['"]/g` — a
 * re-export with a clause, never `export type …`.
 *
 * @param line - One source line (no newline).
 * @returns The specifiers, in order of appearance.
 */
function exportFromSpecifiers(line: string): string[] {
    const specs: string[] = [];
    for (const kw of allOccurrences(line, 'export')) {
        const afterKw = skipSpaces(line, kw + 'export'.length);
        // Requires `\s+` after export, a non-`type` non-empty clause, then from.
        if (afterKw === kw + 'export'.length || startsWithWord(line, afterKw, 'type')) {
            continue;
        }
        const spec = specifierAfterFrom(line, afterKw);
        if (spec !== null) {
            specs.push(spec);
        }
    }
    return specs;
}

/**
 * From position `from` on a line, require a ` from ` keyword (whitespace on
 * both sides) followed by a quoted specifier, and a non-empty clause before it.
 *
 * @param line - The line.
 * @param clauseStart - Index where the import/export clause begins.
 * @returns The specifier, or null.
 */
function specifierAfterFrom(line: string, clauseStart: number): string | null {
    const fromAt = findKeywordFrom(line, clauseStart);
    if (fromAt === -1) {
        return null;
    }
    // A clause must sit between the keyword and `from` (the old `\S(?:.*\S)?`).
    if (skipSpaces(line, clauseStart) >= fromAt) {
        return null;
    }
    const afterFrom = skipSpaces(line, fromAt + 'from'.length);
    return readQuoted(line, afterFrom);
}

/**
 * Index of the first word-boundaried `from` at/after `at` that has whitespace
 * before it, or -1.
 *
 * @param line - The line.
 * @param at - Search start.
 * @returns The `from` index, or -1.
 */
function findKeywordFrom(line: string, at: number): number {
    let i = line.indexOf('from', at);
    while (i !== -1) {
        const before = line[i - 1];
        const after = line[i + 'from'.length];
        if (before !== undefined && /\s/.test(before) && after !== undefined && /\s/.test(after)) {
            return i;
        }
        i = line.indexOf('from', i + 1);
    }
    return -1;
}

/**
 * Read a `'…'` / `"…"` string starting at `at` (which must be the opening
 * quote), returning its inner text with no quotes — mirroring `['"]([^'"]+)['"]`
 * (at least one non-quote character; a backslash is an ordinary char here).
 *
 * @param line - The line.
 * @param at - Index of the opening quote.
 * @returns The inner text, or null when not a non-empty quoted string.
 */
function readQuoted(line: string, at: number): string | null {
    const quote = line[at];
    if (quote !== '"' && quote !== "'") {
        return null;
    }
    const close = line.indexOf(quote, at + 1);
    if (close <= at + 1) {
        return null;
    }
    return line.slice(at + 1, close);
}

/**
 * All indices where `word` appears. The old regexes had no leading word
 * boundary before `import`/`export`, so every occurrence is a candidate; the
 * `\s+`-after check in the callers does the real filtering.
 *
 * @param line - The line.
 * @param word - The keyword.
 * @returns Start indices in order.
 */
function allOccurrences(line: string, word: string): number[] {
    const positions: number[] = [];
    let i = line.indexOf(word);
    while (i !== -1) {
        positions.push(i);
        i = line.indexOf(word, i + 1);
    }
    return positions;
}

/**
 * Whether `word` starts at `at` as a whole word (followed by a non-word char).
 *
 * @param line - The line.
 * @param at - Index to test.
 * @param word - The word.
 * @returns True on a whole-word match.
 */
function startsWithWord(line: string, at: number, word: string): boolean {
    if (!line.startsWith(word, at)) {
        return false;
    }
    const after = line[at + word.length];
    return after === undefined || !/\w/.test(after);
}

/**
 * First index at/after `at` that is not an ASCII space or tab on this line.
 *
 * @param line - The line.
 * @param at - Search start.
 * @returns The first non-space index.
 */
function skipSpaces(line: string, at: number): number {
    let i = at;
    while (i < line.length && /\s/.test(line[i] as string)) {
        i++;
    }
    return i;
}

/**
 * Normalizes bundler module IDs to a stable path key.
 *
 * @param id module ID/path
 * @returns normalized module ID
 */
function normalizeModuleId(id: string): string {
    const clean = id.split('?')[0] ?? id;
    const cached = normalizedModuleIdCache.get(clean);
    if (cached) {
        return cached;
    }
    let normalized: string;
    try {
        normalized = normalizePathSeparators(fs.realpathSync.native(clean));
    } catch {
        normalized = normalizePathSeparators(path.resolve(clean));
    }
    normalizedModuleIdCache.set(clean, normalized);
    return normalized;
}

/**
 * Resolves a relative module specifier to a normalized module ID.
 *
 * @param importer normalized importer path
 * @param source relative import source
 * @returns normalized resolved module ID, or null when unsupported/missing
 */
function resolveLocalModule(importer: string, source: string): string | null {
    const cacheKey = `${importer}\0${source}`;
    const cached = resolvedLocalModuleCache.get(cacheKey);
    if (cached) {
        // Self-heal a stale positive hit: when the resolved file is deleted,
        // pruneRSCModulePathCaches can miss this entry if the cached value and
        // the watcher-reported path normalize to different spellings (on macOS
        // a deleted file can no longer be realpath'd, so the prune key falls
        // back to the raw /var form while this value holds the /private/var
        // realpath). Verifying existence here drops the entry and re-resolves.
        if (fs.existsSync(cached)) {
            return cached;
        }
        resolvedLocalModuleCache.delete(cacheKey);
    }

    const base = source.startsWith('/') ? source : path.resolve(path.dirname(importer), source);
    const candidates = [
        base,
        `${base}.tsx`,
        `${base}.ts`,
        `${base}.jsx`,
        `${base}.js`,
        `${base}.mjs`,
        `${base}.cjs`,
        path.join(base, 'index.tsx'),
        path.join(base, 'index.ts'),
        path.join(base, 'index.jsx'),
        path.join(base, 'index.js'),
    ];

    for (const candidate of candidates) {
        try {
            if (!fs.statSync(candidate).isFile()) {
                continue;
            }
            const resolved = normalizeModuleId(candidate);
            resolvedLocalModuleCache.set(cacheKey, resolved);
            return resolved;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
    }

    return null;
}

/**
 * Drops positive path cache entries that point at a deleted module.
 *
 * @param moduleIds normalized and raw path spellings that should be removed
 */
function pruneRSCModulePathCaches(moduleIds: Set<string>): void {
    for (const [key, value] of normalizedModuleIdCache) {
        const normalizedKey = normalizePathSeparators(key);
        if (moduleIds.has(value) || moduleIds.has(normalizedKey)) {
            normalizedModuleIdCache.delete(key);
        }
    }
    for (const [key, value] of resolvedLocalModuleCache) {
        if (moduleIds.has(value)) {
            resolvedLocalModuleCache.delete(key);
        }
    }
}

/**
 * Extract runtime source names from a named import block.
 *
 * @param clause Static import clause.
 * @returns Imported source symbols.
 */
function readNamedImportedSymbols(clause: string): string[] {
    const openBrace = clause.indexOf('{');
    const closeBrace = openBrace === -1 ? -1 : clause.indexOf('}', openBrace);
    if (openBrace === -1 || closeBrace === -1) {
        return [];
    }
    return clause
        .slice(openBrace + 1, closeBrace)
        .split(',')
        .map(part => part.trim())
        .filter(part => part !== '' && !part.startsWith('type '))
        .map(part =>
            part
                .replace(/^type[ \t]+/, '')
                .split(/(?<![ \t])[ \t]+as[ \t]+/)[0]
                ?.trim(),
        )
        .filter((symbol): symbol is string => Boolean(symbol));
}

/**
 * Extract a forbidden default import symbol from a clause.
 *
 * @param clause Static import clause.
 * @returns Forbidden default symbol or null.
 */
function readForbiddenDefaultSymbol(clause: string): string | null {
    const braceStart = clause.indexOf('{');
    const braceEnd = clause.indexOf('}', braceStart);
    const stripped =
        braceStart !== -1 && braceEnd !== -1
            ? clause.slice(0, braceStart) + clause.slice(braceEnd + 1)
            : clause;
    const candidate = stripped.trimStart().split(',', 1)[0]?.trim() ?? '';
    return isIdentifier(candidate) && FORBIDDEN_SYMBOLS.has(candidate) ? candidate : null;
}

/**
 * Test whether a clause contains a valid namespace import.
 *
 * @param clause Static import clause.
 * @returns Whether the clause imports a namespace.
 */
function hasNamespaceImport(clause: string): boolean {
    const parts = splitAsciiWhitespace(clause);
    return (
        parts.length >= 3 && parts[0] === '*' && parts[1] === 'as' && isIdentifier(parts[2] ?? '')
    );
}

/**
 * Extracts source symbol names from an import clause.
 *
 * @param clause static import clause
 * @returns imported source symbols
 */
function readImportedSymbols(clause: string): string[] {
    const symbols = readNamedImportedSymbols(clause);
    if (hasNamespaceImport(clause)) {
        symbols.push(...FORBIDDEN_SYMBOLS);
    }
    const defaultSymbol = readForbiddenDefaultSymbol(clause);
    if (defaultSymbol) {
        symbols.push(defaultSymbol);
    }

    return symbols;
}

/**
 * Checks whether a token is a JavaScript identifier accepted in import
 * clauses. Import parsing only needs ASCII because csszyx runtime helper names
 * are ASCII.
 *
 * @param value Candidate import token.
 * @returns Whether the token is an identifier.
 */
function isIdentifier(value: string): boolean {
    if (value.length === 0 || !isIdentifierStart(readCodePoint(value, 0))) {
        return false;
    }
    for (let index = 1; index < value.length; index += 1) {
        const code = readCodePoint(value, index);
        if (!isIdentifierStart(code) && (code < 48 || code > 57)) {
            return false;
        }
    }
    return true;
}

/**
 * Returns whether a character code can start an ASCII identifier.
 *
 * @param code Character code.
 * @returns Whether the character can start an identifier.
 */
function isIdentifierStart(code: number): boolean {
    return code === 36 || code === 95 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * Read a Unicode code point while preserving the scanner's UTF-16 offsets.
 *
 * @param value Source text.
 * @param index UTF-16 offset.
 * @returns The code point, or a non-identifier sentinel outside the string.
 */
function readCodePoint(value: string, index: number): number {
    return value.codePointAt(index) ?? -1;
}

/**
 * Splits import syntax on JavaScript ASCII whitespace in linear time.
 *
 * @param value Import syntax fragment.
 * @returns Non-empty tokens.
 */
function splitAsciiWhitespace(value: string): string[] {
    const parts: string[] = [];
    let start = -1;
    for (let index = 0; index <= value.length; index += 1) {
        const code = index < value.length ? readCodePoint(value, index) : 32;
        const whitespace = code === 9 || code === 10 || code === 13 || code === 32;
        if (whitespace) {
            if (start !== -1) {
                parts.push(value.slice(start, index));
                start = -1;
            }
        } else if (start === -1) {
            start = index;
        }
    }
    return parts;
}

/**
 * Removes comments before regex import scanning while preserving strings and
 * line positions for readable error output.
 *
 * @param code module source
 * @returns source with comments replaced by whitespace
 */
function stripCommentsForImportScan(code: string): string {
    let out = '';
    let i = 0;
    let quote: '"' | "'" | '`' | null = null;
    let escaped = false;

    while (i < code.length) {
        const ch = code[i];
        const next = code[i + 1];

        if (quote) {
            out += ch;
            ({ quote, escaped } = advanceQuotedImportScan(ch, quote, escaped));
            i++;
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            out += ch;
            i++;
            continue;
        }

        if (ch === '/' && next === '/') {
            const masked = maskLineComment(code, i);
            out += masked.value;
            i = masked.end;
            continue;
        }

        if (ch === '/' && next === '*') {
            const masked = maskBlockComment(code, i);
            out += masked.value;
            i = masked.end;
            continue;
        }

        out += ch;
        i++;
    }

    return out;
}

/**
 * Advances quote and escape state for one character inside a string.
 *
 * @param character - Current source character.
 * @param quote - Active quote delimiter.
 * @param escaped - Whether the current character is escaped.
 * @returns Updated quote and escape state.
 */
function advanceQuotedImportScan(
    character: string,
    quote: '"' | "'" | '`',
    escaped: boolean,
): { quote: '"' | "'" | '`' | null; escaped: boolean } {
    if (escaped) return { quote, escaped: false };
    if (character === '\\') return { quote, escaped: true };
    return { quote: character === quote ? null : quote, escaped: false };
}

/** Masked comment fragment and the next source offset. */
interface MaskedComment {
    end: number;
    value: string;
}

/**
 * Replaces a line comment with spaces without consuming its newline.
 *
 * @param code - Module source.
 * @param start - Slash offset.
 * @returns Masked comment and next source offset.
 */
function maskLineComment(code: string, start: number): MaskedComment {
    const newline = code.indexOf('\n', start + 2);
    const end = newline === -1 ? code.length : newline;
    return { end, value: ' '.repeat(end - start) };
}

/**
 * Replaces a block comment with whitespace while preserving newlines.
 *
 * @param code - Module source.
 * @param start - Slash offset.
 * @returns Masked comment and next source offset.
 */
function maskBlockComment(code: string, start: number): MaskedComment {
    let end = start + 2;
    while (end < code.length) {
        if (code.charAt(end) === '*' && code.charAt(end + 1) === '/') {
            end += 2;
            break;
        }
        end += 1;
    }
    let value = '';
    for (let index = start; index < end; index += 1) {
        value += code.charAt(index) === '\n' ? '\n' : ' ';
    }
    return { end, value };
}
