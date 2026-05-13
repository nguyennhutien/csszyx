const SERVER_DIRECTIVE_RE = /^['"]use server['"];?$/;
const CLIENT_DIRECTIVE_RE = /^['"]use client['"];?$/;

const RUNTIME_MODULES = new Set([
    '@csszyx/runtime',
    '@csszyx/runtime/lite',
    'csszyx',
    'csszyx/lite',
]);

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
 * Detects Next App Router route entry files that are Server Components unless
 * they opt into `'use client'`.
 *
 * @param id module ID/path
 * @returns true for supported Next App Router route entry filenames
 */
function isNextAppRouterEntry(id: string): boolean {
    const clean = id.split('?')[0]?.replace(/\\/g, '/') ?? id;
    return /(^|\/)app\/.*\/?(?:page|layout|template|loading|error|not-found|global-error|default|route)\.[cm]?[tj]sx?$/.test(clean);
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

    throw new Error(
        `csszyxRSCViolation: ${violation.symbol} imported in Server Component ${violation.path}\n` +
        `  Import chain: ${violation.importChain.join(' -> ')}`,
    );
}

/**
 * Reads the top-level directive prologue without requiring a full parser.
 *
 * @param code module source
 * @returns normalized directive statements
 */
function readDirectivePrologue(code: string): string[] {
    const out: string[] = [];
    let i = code.charCodeAt(0) === 0xFEFF ? 1 : 0;

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
    const staticImportRe = /import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    const sideEffectImportRe = /import\s+['"]([^'"]+)['"]/g;
    const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    let match;
    while ((match = staticImportRe.exec(code)) !== null) {
        const clause = match[1];
        const source = match[2];
        if (!RUNTIME_MODULES.has(source)) {
            continue;
        }
        imports.push({ source, symbols: readImportedSymbols(clause) });
    }

    while ((match = sideEffectImportRe.exec(code)) !== null) {
        const source = match[1];
        if (RUNTIME_MODULES.has(source)) {
            imports.push({ source, symbols: [] });
        }
    }

    while ((match = dynamicImportRe.exec(code)) !== null) {
        const source = match[1];
        if (RUNTIME_MODULES.has(source)) {
            imports.push({ source, symbols: Array.from(FORBIDDEN_SYMBOLS) });
        }
    }

    return imports;
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
            const sourceName = trimmed.replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
            if (sourceName) {
                symbols.push(sourceName);
            }
        }
    }

    if (/\*\s+as\s+\w+/.test(clause)) {
        symbols.push(...FORBIDDEN_SYMBOLS);
    }

    return symbols;
}
