/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import type { SourceTransformResult, TransformSourceCodeOptions } from '@csszyx/compiler';
import { ensureRustTransformAvailable } from '@csszyx/compiler/engine';
import { transformRustUnrendered, transformWasmUnrendered } from '@csszyx/compiler/internal';
import type { ResolvedCrossModuleEntries } from './cross-module-registry.js';
import { diagnosticError } from './diagnostic-message.js';
import { withCrossModuleStatics } from './next-cross-module.js';
import { projectRelative } from './path-case.js';
import { normalizePathSeparators } from './path-normalization.js';
import {
    createTransformCacheKey,
    readTransformCache,
    type TransformCacheKeyInput,
    type TransformCacheProducer,
    writeTransformCache,
} from './transform-cache.js';

/** Parser mode supported by the Next Turbopack source transformer. */
export type NextSourceParserMode = 'rust' | 'wasm';

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
}

/**
 * The compiler options a Next lane lowers one module with. The loader and the
 * prebuild both build them here: the prebuild's transform is cached and the
 * loader reads it back, so options that differ between them would serve the
 * loader output it did not ask for.
 *
 * `rootDir` names each diagnostic's file from the project root, as the Vite
 * and webpack lanes do; without it the header carried the absolute path.
 *
 * @param input - What the module is lowered with.
 * @param input.base - The lane's own compiler options.
 * @param input.statics - The cross-module values the module reads.
 * @param input.classPrefix - The project's Tailwind prefix, or null for none.
 * @param input.root - The project root.
 * @returns The options.
 */
export function nextCompilerOptions(input: {
    base: TransformSourceCodeOptions | undefined;
    statics: ResolvedCrossModuleEntries;
    classPrefix: string | null;
    root: string;
}): TransformSourceCodeOptions {
    return {
        ...withCrossModuleStatics(input.base, input.statics),
        classPrefix: input.classPrefix,
        rootDir: input.root,
    };
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
    // Null is a real answer: no stylesheet sets a prefix. Undefined means the
    // lane never asked, which only a lane csszyx forgot to wire can do.
    if (input.compilerOptions?.classPrefix === undefined) {
        throw diagnosticError('internal-error', {
            where: 'transformNextSource',
            detail: "a Next build asked the engine to transform a module before it read the project's Tailwind prefix",
        });
    }
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
    const rootDir = input.compilerOptions.rootDir;
    assertNoUnsafePassThrough(
        input.source,
        result.result,
        rootDir === undefined ? filename : projectRelative(rootDir, filename),
    );
    if (input.cacheRoot && cacheKey && result.producer === producer) {
        writeTransformCache(input.cacheRoot, cacheInput, result.result, cacheKey);
        return { ...result, cacheStatus: 'write' };
    }

    return { ...result, cacheStatus: input.cacheRoot ? 'miss' : 'disabled' };
}

/**
 * Stop on a module the transform handed back unchanged while it still holds
 * `sz` syntax: passed through, it would ship an `sz` prop React renders as an
 * attribute, with no class at all.
 *
 * @param source - The module as read.
 * @param result - What the transform returned.
 * @param file - The module, as its header names it.
 * @throws {CsszyxError} `next-sz-untransformed`.
 */
function assertNoUnsafePassThrough(
    source: string,
    result: SourceTransformResult,
    file: string,
): void {
    if (!hasSzSyntax(source)) {
        return;
    }
    if (!result.transformed && result.code === source) {
        throw diagnosticError('next-sz-untransformed', {}, { at: file });
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
            index = skipLineComment(source, index);
            continue;
        }
        if (char === '/' && peek === '*') {
            index = skipBlockComment(source, index);
            continue;
        }
        if (char === '/' && isRegexLiteralStart(out)) {
            index = skipRegexLiteral(source, index);
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            index = skipQuotedSource(source, index, char);
            continue;
        }

        out += char;
        index++;
    }
    return out;
}

/**
 * Skips a line comment without consuming its newline.
 *
 * @param source
 * @param start
 * @returns Next source offset.
 */
function skipLineComment(source: string, start: number): number {
    const newline = source.indexOf('\n', start + 2);
    return newline === -1 ? source.length : newline;
}

/**
 * Skips a block comment, including its closing delimiter when present.
 *
 * @param source
 * @param start
 * @returns Next source offset.
 */
function skipBlockComment(source: string, start: number): number {
    const close = source.indexOf('*/', start + 2);
    return close === -1 ? source.length : close + 2;
}

/**
 * Skips a regex literal, escaped characters, character classes, and flags.
 *
 * @param source
 * @param start
 * @returns Next source offset.
 */
function skipRegexLiteral(source: string, start: number): number {
    let index = start + 1;
    let inCharClass = false;
    while (index < source.length) {
        const current = source[index];
        if (current === '\\' && index + 1 < source.length) {
            index += 2;
            continue;
        }
        if (current === '[') {
            inCharClass = true;
        } else if (current === ']') {
            inCharClass = false;
        } else if (current === '/' && !inCharClass) {
            return skipRegexFlags(source, index + 1);
        }
        index++;
    }
    return index;
}

/**
 * Skips ASCII regex flags after a closing delimiter.
 *
 * @param source
 * @param start
 * @returns Next source offset.
 */
function skipRegexFlags(source: string, start: number): number {
    let index = start;
    while (/[a-z]/i.test(source[index] ?? '')) index++;
    return index;
}

/**
 * Skips a quoted string or template literal with escape handling.
 *
 * @param source
 * @param start
 * @param quote
 * @returns Next source offset.
 */
function skipQuotedSource(source: string, start: number, quote: string): number {
    let index = start + 1;
    while (index < source.length && source[index] !== quote) {
        index += source[index] === '\\' && index + 1 < source.length ? 2 : 1;
    }
    return index + 1;
}

/**
 *
 * @param emitted
 */
function isRegexLiteralStart(emitted: string): boolean {
    const trimmed = emitted.trimEnd();
    const previous = trimmed.length > 0 ? trimmed.charAt(trimmed.length - 1) : undefined;
    return previous === undefined || /[({[=:;,!&|?+\-*%^~<>]/.test(previous);
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
    if (input.parserMode === 'rust') {
        return {
            result: transformRustUnrendered(input.source, { ...compilerOptions, filename }),
            producer: 'rust',
        };
    }
    return {
        result: transformWasmUnrendered(input.source, { ...compilerOptions, filename }),
        producer: 'wasm',
    };
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
        // A transform made under one Tailwind prefix emits classes a build under
        // another does not serve.
        classPrefix: input.compilerOptions?.classPrefix,
        mangleVarHoistMaxDepth: input.compilerOptions?.mangleVarHoistMaxDepth,
        globalVarAliases: normalizeGlobalVarAliasesForCache(
            input.compilerOptions?.globalVarAliases,
        ),
        // The registry slice this file was compiled against is part of its
        // identity. Without it an edited provider serves its importers the
        // cached output built from the value it used to have — the one failure
        // this lane refused to risk before it resolved anything at all.
        crossModuleStatics:
            input.compilerOptions?.crossModuleStatics === undefined
                ? undefined
                : JSON.stringify(input.compilerOptions.crossModuleStatics),
        crossModuleSzObjects:
            input.compilerOptions?.crossModuleSzObjects === undefined
                ? undefined
                : JSON.stringify(input.compilerOptions.crossModuleSzObjects),
        filename,
        source: input.source,
    };
}

/**
 *
 * @param filename
 */
function normalizeSourceFilename(filename: string): string {
    return normalizePathSeparators(filename);
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
    let entries: Iterable<[string, string]>;
    if (aliases instanceof Map) entries = aliases.entries();
    else if (Array.isArray(aliases)) entries = aliases;
    else entries = Object.entries(aliases);
    const normalized = new Map<string, string>();
    for (const [original, alias] of entries) {
        if (original.startsWith('--') && alias.startsWith('--')) {
            normalized.set(original, alias);
        }
    }
    return [...normalized].sort(([left], [right]) => left.localeCompare(right));
}
