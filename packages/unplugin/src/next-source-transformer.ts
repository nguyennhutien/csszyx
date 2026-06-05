/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import {
    ensureRustTransformAvailable,
    type SourceTransformResult,
    type TransformSourceCodeOptions,
    transformOxc,
    transformRust,
    transformSourceCode,
} from '@csszyx/compiler';

import {
    createTransformCacheKey,
    readTransformCache,
    type TransformCacheKeyInput,
    type TransformCacheProducer,
    writeTransformCache,
} from './transform-cache.js';

/** Parser mode supported by the Next Turbopack source transformer. */
export type NextSourceParserMode = 'babel' | 'oxc' | 'rust';

/** Inputs for one fail-closed source transform. */
export interface NextSourceTransformInput {
    source: string;
    filename: string;
    parserMode: NextSourceParserMode;
    compilerOptions?: TransformSourceCodeOptions;
    cacheRoot?: string;
    pluginVersion: string;
    compilerVersion: string;
    astBudget?: number;
    allowBabelFallback?: boolean;
}

/** Result of one source transform plus cache metadata for loader diagnostics. */
export interface NextSourceTransformOutput {
    result: SourceTransformResult;
    cacheStatus: 'disabled' | 'hit' | 'miss' | 'write';
    producer: TransformCacheProducer;
}

/**
 * Transform one source module for the future Next Turbopack watcher/loader.
 *
 * This intentionally covers only the compiler source transform contract.
 * Runtime import injection, layout placeholders, and bundler-state collection
 * remain separate gates so the loader cannot accidentally claim full parity.
 *
 * @param input Source transform input.
 * @returns Transform result and cache metadata.
 */
export function transformNextSource(input: NextSourceTransformInput): NextSourceTransformOutput {
    const filename = normalizeSourceFilename(input.filename);
    const producer: TransformCacheProducer = input.parserMode;
    const cacheInput = createNextSourceTransformCacheInput(input, filename, producer);

    if (input.parserMode === 'rust') {
        ensureRustTransformAvailable();
    }

    const cacheKey = input.cacheRoot ? createTransformCacheKey(cacheInput) : null;
    if (input.cacheRoot && cacheKey) {
        const cached = readTransformCache(input.cacheRoot, cacheInput, cacheKey);
        if (cached) {
            return { result: cached, cacheStatus: 'hit', producer };
        }
    }

    const result = runNextSourceTransform(input, filename);
    assertNoUnsafePassThrough(input.source, result.result, filename);
    if (input.cacheRoot && cacheKey && result.producer === producer) {
        writeTransformCache(input.cacheRoot, cacheInput, result.result, cacheKey);
        return { ...result, cacheStatus: 'write' };
    }

    return { ...result, cacheStatus: input.cacheRoot ? 'miss' : 'disabled' };
}

/**
 *
 * @param source
 * @param result
 * @param filename
 */
function assertNoUnsafePassThrough(
    source: string,
    result: SourceTransformResult,
    filename: string,
): void {
    if (!hasSzSyntax(source)) {
        return;
    }
    if (!result.transformed && result.code === source) {
        throw new Error(
            `[csszyx] Next source transform failed closed for ${filename}: source still contains csszyx sz syntax.`,
        );
    }
}

/**
 *
 * @param source
 */
function hasSzSyntax(source: string): boolean {
    // The fail-closed guard only fires when the compiler returned a
    // pass-through result, so we are looking for sz syntax that the parser
    // should have caught. Real sz props live in JSX attributes (`sz={...}`)
    // or in object-literal positions (`sz: {...}`, `sz: "..."`); they never
    // live inside comments or string literals. Stripping comments and
    // strings before the pattern match prevents `// sz=` annotations and
    // `'text with sz=...'` payloads from spuriously tripping the guard.
    const cleaned = stripJsCommentsAndStrings(source);
    return /\bsz\s*=/.test(cleaned) || /\bsz\s*:\s*[{"']/.test(cleaned);
}

/**
 *
 * @param source
 */
function stripJsCommentsAndStrings(source: string): string {
    let out = '';
    let index = 0;
    const length = source.length;
    while (index < length) {
        const char = source[index];
        const peek = index + 1 < length ? source[index + 1] : '';

        if (char === '/' && peek === '/') {
            index += 2;
            while (index < length && source[index] !== '\n') {
                index++;
            }
            continue;
        }
        if (char === '/' && peek === '*') {
            index += 2;
            while (index + 1 < length && !(source[index] === '*' && source[index + 1] === '/')) {
                index++;
            }
            index = Math.min(length, index + 2);
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            const quote = char;
            index++;
            while (index < length && source[index] !== quote) {
                if (source[index] === '\\' && index + 1 < length) {
                    index += 2;
                } else {
                    index++;
                }
            }
            index++;
            continue;
        }

        out += char;
        index++;
    }
    return out;
}

/**
 *
 * @param input
 * @param filename
 */
function runNextSourceTransform(
    input: NextSourceTransformInput,
    filename: string,
): Pick<NextSourceTransformOutput, 'result' | 'producer'> {
    const compilerOptions = input.compilerOptions;
    if (input.parserMode === 'babel') {
        return {
            result: transformSourceCode(input.source, filename, compilerOptions),
            producer: 'babel',
        };
    }
    if (input.parserMode === 'rust') {
        return {
            result: transformRust(input.source, filename, compilerOptions),
            producer: 'rust',
        };
    }

    try {
        return {
            result: transformOxc(input.source, filename, compilerOptions),
            producer: 'oxc',
        };
    } catch (error) {
        if (input.allowBabelFallback === false) {
            throw error;
        }
        const result = transformSourceCode(input.source, filename, compilerOptions);
        const reason = error instanceof Error ? error.message : String(error);
        result.diagnostics.push(
            `[csszyx] oxc parser fell back to Babel for ${filename}: ${reason}`,
        );
        return { result, producer: 'babel-fallback' };
    }
}

/**
 *
 * @param input
 * @param filename
 * @param producer
 */
function createNextSourceTransformCacheInput(
    input: NextSourceTransformInput,
    filename: string,
    producer: TransformCacheProducer,
): TransformCacheKeyInput {
    return {
        pluginVersion: input.pluginVersion,
        compilerVersion: input.compilerVersion,
        parserMode: input.parserMode,
        producer,
        astBudget: input.astBudget ?? input.compilerOptions?.astBudget,
        mangleVars: input.compilerOptions?.mangleVars,
        mangleVarHoistMaxDepth: input.compilerOptions?.mangleVarHoistMaxDepth,
        globalVarAliases: normalizeGlobalVarAliasesForCache(
            input.compilerOptions?.globalVarAliases,
        ),
        filename,
        source: input.source,
    };
}

/**
 *
 * @param filename
 */
function normalizeSourceFilename(filename: string): string {
    return filename.replace(/\\/g, '/');
}

/**
 *
 * @param aliases
 */
function normalizeGlobalVarAliasesForCache(
    aliases: TransformSourceCodeOptions['globalVarAliases'],
): Array<[string, string]> {
    if (!aliases) {
        return [];
    }
    const entries =
        aliases instanceof Map
            ? aliases.entries()
            : Array.isArray(aliases)
              ? aliases
              : Object.entries(aliases);
    const normalized = new Map<string, string>();
    for (const [original, alias] of entries) {
        if (original.startsWith('--') && alias.startsWith('--')) {
            normalized.set(original, alias);
        }
    }
    return [...normalized].sort(([left], [right]) => left.localeCompare(right));
}
