import * as fs from 'node:fs';
import * as path from 'node:path';

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

const FORBIDDEN_SYMBOLS = new Set([
    '_sz',
    '_sz2',
    '_sz3',
    '_szIf',
    '_szMerge',
    '_szSwitch',
    '__csszyx_runtime__',
]);

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
function isNextAppRouterEntry(id: string): boolean {
    const clean = id.split('?')[0]?.replace(/\\/g, '/') ?? id;
    return /(^|\/)app\/.*\/?(?:page|layout|template|loading|error|not-found|global-error|default|route)\.[cm]?[tj]sx?$/.test(
        clean,
    );
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
 * Reads the top-level directive prologue without requiring a full parser.
 *
 * @param code module source
 * @returns normalized directive statements
 */
function readDirectivePrologue(code: string): string[] {
    const out: string[] = [];
    let i = code.charCodeAt(0) === 0xfeff ? 1 : 0;

    while (i < code.length) {
        i = skipWhitespaceAndComments(code, i);
        const quote = code[i];
        if (quote !== '"' && quote !== "'") {
            break;
        }

        let j = i + 1;
        let escaped = false;
        while (j < code.length) {
            const ch = code[j];
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                break;
            }
            j++;
        }
        if (j >= code.length) {
            break;
        }

        let end = j + 1;
        while (end < code.length && /[ \t\r\n]/.test(code[end])) {
            end++;
        }
        if (code[end] === ';') {
            end++;
        }

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
    const staticImportRe = /import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    const sideEffectImportRe = /import\s+['"]([^'"]+)['"]/g;
    const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (const match of scanCode.matchAll(staticImportRe)) {
        const clause = match[1];
        const source = match[2];
        if (!isRuntimeImportSource(source)) {
            continue;
        }
        imports.push({ source, symbols: readRuntimeImportSymbols(source, clause) });
    }

    for (const match of scanCode.matchAll(sideEffectImportRe)) {
        const source = match[1];
        if (isRuntimeImportSource(source)) {
            imports.push({
                source,
                symbols: isWholeRuntimeModuleForbidden(source) ? Array.from(FORBIDDEN_SYMBOLS) : [],
            });
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
function findLocalImportSources(code: string): string[] {
    const out: string[] = [];
    const staticImportRe = /import\s+(?!type\b)(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    const exportFromRe = /export\s+(?!type\b)(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (const re of [staticImportRe, exportFromRe, dynamicImportRe]) {
        for (const match of code.matchAll(re)) {
            const source = match[1];
            if (source.startsWith('.') || source.startsWith('/')) {
                out.push(source);
            }
        }
    }

    return out;
}

/**
 * Normalizes bundler module IDs to a stable path key.
 *
 * @param id module ID/path
 * @returns normalized module ID
 */
function normalizeModuleId(id: string): string {
    const clean = id.split('?')[0] ?? id;
    try {
        return fs.realpathSync.native(clean).replace(/\\/g, '/');
    } catch {
        return path.resolve(clean).replace(/\\/g, '/');
    }
}

/**
 * Resolves a relative module specifier to a normalized module ID.
 *
 * @param importer normalized importer path
 * @param source relative import source
 * @returns normalized resolved module ID, or null when unsupported/missing
 */
function resolveLocalModule(importer: string, source: string): string | null {
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
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return normalizeModuleId(candidate);
        }
    }

    return null;
}

/**
 * Extracts source symbol names from an import clause.
 *
 * @param clause static import clause
 * @returns imported source symbols
 */
function readImportedSymbols(clause: string): string[] {
    const symbols: string[] = [];
    const named = clause.match(/\{([\s\S]*?)\}/);
    if (named) {
        for (const part of named[1].split(',')) {
            const trimmed = part.trim();
            if (!trimmed || trimmed.startsWith('type ')) {
                continue;
            }
            const sourceName = trimmed
                .replace(/^type\s+/, '')
                .split(/\s+as\s+/)[0]
                ?.trim();
            if (sourceName) {
                symbols.push(sourceName);
            }
        }
    }

    if (/\*\s+as\s+\w+/.test(clause)) {
        symbols.push(...FORBIDDEN_SYMBOLS);
    }

    const defaultImport = clause
        .replace(/\{[\s\S]*?\}/, '')
        .match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    const defaultSymbol = defaultImport?.[1];
    if (defaultSymbol && FORBIDDEN_SYMBOLS.has(defaultSymbol)) {
        symbols.push(defaultSymbol);
    }

    return symbols;
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
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                quote = null;
            }
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
            out += '  ';
            i += 2;
            while (i < code.length && code[i] !== '\n') {
                out += ' ';
                i++;
            }
            continue;
        }

        if (ch === '/' && next === '*') {
            out += '  ';
            i += 2;
            while (i < code.length) {
                const blockCh = code[i];
                const blockNext = code[i + 1];
                if (blockCh === '*' && blockNext === '/') {
                    out += '  ';
                    i += 2;
                    break;
                }
                out += blockCh === '\n' ? '\n' : ' ';
                i++;
            }
            continue;
        }

        out += ch;
        i++;
    }

    return out;
}
