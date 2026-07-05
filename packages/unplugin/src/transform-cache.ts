import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CssVariableMangleValue, SourceTransformResult, TokenData } from '@csszyx/compiler';

// 9: the compiled sz-array lane emits `_szcn(` (unmemoized) instead of
// `szcn(` and injects the matching import — cached code from schema 8 would
// mix the old call shape into a new build.
const CACHE_SCHEMA_VERSION = 9;

/** Parser implementation that produced a cache entry. */
export type TransformCacheProducer = 'babel' | 'babel-fallback' | 'oxc' | 'rust';

/** Transform result shape that can be serialized into the on-disk cache. */
export type CacheableTransformResult = SourceTransformResult;

/** JSON-safe transform result stored inside a cache entry. */
interface SerializedTransformResult {
    code: string;
    transformed: boolean;
    usesRuntime: boolean;
    usesMerge: boolean;
    usesSzcn: boolean;
    usesSzPart: boolean;
    usesColorVar: boolean;
    classes: string[];
    rawClassNames: string[];
    diagnostics: string[];
    recoveryTokens: Array<[string, TokenData]>;
    cssVariableMap: Array<[string, CssVariableMangleValue]>;
}

/** On-disk transform cache entry schema. */
interface TransformCacheEntry {
    version: number;
    pluginVersion: string;
    compilerVersion: string;
    nativeIdentity: string | null;
    parserMode: string;
    producer: TransformCacheProducer;
    astBudget: number | null;
    mangleVars: boolean;
    mangleVarHoistMaxDepth: number | null;
    globalVarAliases: Array<[string, string]>;
    filename: string;
    inputSha256: string;
    timestamp: string;
    result: SerializedTransformResult;
}

/** Transform cache eviction settings. */
export interface TransformCacheEvictionOptions {
    /** Maximum entry age in milliseconds. */
    maxAgeMs: number;
    /** Maximum number of cache JSON entries to keep after age eviction. */
    maxEntries?: number;
    /** Current timestamp for deterministic tests. */
    now?: number;
}

/** Inputs that affect transform cache identity. */
export interface TransformCacheKeyInput {
    /** @csszyx/unplugin package version. */
    pluginVersion: string;
    /** @csszyx/compiler package version. */
    compilerVersion: string;
    /**
     * Identity of the native engine binary that produces rust-mode output
     * (version plus binary mtime/size). Package versions alone cannot
     * invalidate the cache when the same version is rebuilt from changed
     * sources in a workspace, which served stale transforms after engine
     * fixes. Unset for parsers that do not call the native engine.
     */
    nativeIdentity?: string;
    /** Active parser mode. */
    parserMode: string;
    /** Parser implementation that must have produced the cached output. */
    producer: TransformCacheProducer;
    /** Effective AST budget override, if configured. */
    astBudget?: number;
    /** Whether dynamic CSS variable names are mangled by the compiler. */
    mangleVars?: boolean;
    /** Maximum cascade depth for component-tier CSS variable hoisting. */
    mangleVarHoistMaxDepth?: number;
    /** Exact global custom-property alias table used by compiler rewrites. */
    globalVarAliases?: ReadonlyArray<readonly [string, string]>;
    /** Source filename; recovery tokens depend on it. */
    filename: string;
    /** Source file contents. */
    source: string;
}

/** Derived transform cache key and full source digest. */
export interface TransformCacheKey {
    /** Short cache key used as the filename. */
    key: string;
    /** Full source hash stored for read-time verification. */
    inputSha256: string;
}

/**
 * Resolve the on-disk transform cache directory.
 *
 * @param rootDir Project root.
 * @param cacheDir User configured cache dir, defaults to `.csszyx/cache`.
 * @returns Absolute directory for transform cache entries.
 */
export function resolveTransformCacheDir(rootDir: string, cacheDir?: string): string {
    return path.resolve(rootDir, cacheDir ?? '.csszyx/cache', 'transform');
}

/**
 * Derive a stable transform cache key.
 *
 * @param input Transform inputs that affect compiler output.
 * @returns Short key plus full content hash for read-time verification.
 */
export function createTransformCacheKey(input: TransformCacheKeyInput): TransformCacheKey {
    const inputSha256 = createHash('sha256').update(input.source).digest('hex');
    const globalVarAliases = normalizeGlobalVarAliasEntries(input.globalVarAliases);
    const keyMaterial = [
        `schema=${CACHE_SCHEMA_VERSION}`,
        `plugin=${input.pluginVersion}`,
        `compiler=${input.compilerVersion}`,
        `native=${input.nativeIdentity ?? 'none'}`,
        `parser=${input.parserMode}`,
        `producer=${input.producer}`,
        `astBudget=${input.astBudget ?? 'default'}`,
        `mangleVars=${input.mangleVars === true}`,
        `mangleVarHoistMaxDepth=${input.mangleVarHoistMaxDepth ?? 'default'}`,
        `globalVarAliases=${JSON.stringify(globalVarAliases)}`,
        `filename=${input.filename}`,
        `source=${inputSha256}`,
    ].join('\n');

    return {
        key: createHash('sha256').update(keyMaterial).digest('hex').slice(0, 16),
        inputSha256,
    };
}

/**
 * Read and validate a cached transform result.
 *
 * @param cacheRoot Absolute transform cache directory.
 * @param input Inputs used to validate the cache entry.
 * @param precomputedKey Optional cache key returned by an earlier
 *        `createTransformCacheKey(input)` call. Pass it through to avoid a
 *        redundant sha256 of the same source.
 * @returns Cached transform result, or null on miss/corruption.
 */
export function readTransformCache(
    cacheRoot: string,
    input: TransformCacheKeyInput,
    precomputedKey?: TransformCacheKey,
): CacheableTransformResult | null {
    // Callers that already hashed `input` for an L1 lookup can pass the
    // resulting `TransformCacheKey` here to avoid a second sha256 of the
    // same source. Falling back to fresh derivation keeps the function
    // safe to use standalone.
    const { key, inputSha256 } = precomputedKey ?? createTransformCacheKey(input);
    const globalVarAliases = normalizeGlobalVarAliasEntries(input.globalVarAliases);
    const file = cacheEntryPath(cacheRoot, key);
    let entry: TransformCacheEntry;
    try {
        entry = JSON.parse(fs.readFileSync(file, 'utf8')) as TransformCacheEntry;
    } catch {
        return null;
    }

    if (
        entry.version !== CACHE_SCHEMA_VERSION ||
        entry.pluginVersion !== input.pluginVersion ||
        entry.compilerVersion !== input.compilerVersion ||
        entry.nativeIdentity !== (input.nativeIdentity ?? null) ||
        entry.parserMode !== input.parserMode ||
        entry.producer !== input.producer ||
        entry.astBudget !== (input.astBudget ?? null) ||
        entry.mangleVars !== (input.mangleVars === true) ||
        entry.mangleVarHoistMaxDepth !== (input.mangleVarHoistMaxDepth ?? null) ||
        !sameGlobalVarAliases(entry.globalVarAliases, globalVarAliases) ||
        entry.filename !== input.filename ||
        entry.inputSha256 !== inputSha256
    ) {
        return null;
    }

    return deserializeResult(entry.result);
}

/**
 * Atomically write a transform result to cache.
 *
 * @param cacheRoot Absolute transform cache directory.
 * @param input Inputs that produced the result.
 * @param result Transform result to serialize.
 * @param precomputedKey Optional cache key returned by an earlier
 *        `createTransformCacheKey(input)` call. Pass it through so cold
 *        cache-miss writes do not pay for a second sha256 over the same
 *        source.
 */
export function writeTransformCache(
    cacheRoot: string,
    input: TransformCacheKeyInput,
    result: CacheableTransformResult,
    precomputedKey?: TransformCacheKey,
): void {
    // Same dedup contract as `readTransformCache`: callers that already
    // hashed `input` for cache lookup can pass the existing key here so a
    // cache-miss-then-write does not pay for two sha256 passes over the
    // same source.
    const { key, inputSha256 } = precomputedKey ?? createTransformCacheKey(input);
    const globalVarAliases = normalizeGlobalVarAliasEntries(input.globalVarAliases);
    const file = cacheEntryPath(cacheRoot, key);
    const dir = path.dirname(file);
    const tmp = path.join(
        dir,
        `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const entry: TransformCacheEntry = {
        version: CACHE_SCHEMA_VERSION,
        pluginVersion: input.pluginVersion,
        compilerVersion: input.compilerVersion,
        nativeIdentity: input.nativeIdentity ?? null,
        parserMode: input.parserMode,
        producer: input.producer,
        astBudget: input.astBudget ?? null,
        mangleVars: input.mangleVars === true,
        mangleVarHoistMaxDepth: input.mangleVarHoistMaxDepth ?? null,
        globalVarAliases,
        filename: input.filename,
        inputSha256,
        timestamp: new Date().toISOString(),
        result: serializeResult(result),
    };

    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(entry), 'utf8');
        fs.renameSync(tmp, file);
    } catch {
        try {
            fs.rmSync(tmp, { force: true });
        } catch {
            // Ignore cleanup failures: cache writes must never fail the build.
        }
    }
}

/**
 * Delete transform cache entries older than a threshold and trim oldest
 * remaining entries beyond the optional max-entry cap.
 *
 * @param cacheRoot Absolute transform cache directory.
 * @param options Eviction settings.
 * @returns Number of deleted files.
 */
export function evictOldTransformCacheEntries(
    cacheRoot: string,
    options: TransformCacheEvictionOptions,
): number {
    let deleted = 0;
    const now = options.now ?? Date.now();
    const survivors: Array<{ file: string; timestamp: number }> = [];

    for (const file of listJsonFiles(cacheRoot)) {
        try {
            const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<TransformCacheEntry>;
            const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : 0;
            if (!Number.isFinite(timestamp) || now - timestamp > options.maxAgeMs) {
                fs.rmSync(file, { force: true });
                deleted++;
            } else {
                survivors.push({ file, timestamp });
            }
        } catch {
            fs.rmSync(file, { force: true });
            deleted++;
        }
    }

    const overflow = options.maxEntries ? survivors.length - options.maxEntries : 0;
    if (overflow > 0) {
        survivors.sort((a, b) => a.timestamp - b.timestamp);
        for (const survivor of survivors.slice(0, overflow)) {
            fs.rmSync(survivor.file, { force: true });
            deleted++;
        }
    }

    return deleted;
}

/**
 * Build the cache entry path for a key.
 *
 * @param cacheRoot Absolute cache root.
 * @param key Short cache key.
 * @returns Absolute cache entry path.
 */
function cacheEntryPath(cacheRoot: string, key: string): string {
    return path.join(cacheRoot, key.slice(0, 2), `${key.slice(2)}.json`);
}

/**
 * Serialize Set/Map fields into JSON arrays.
 *
 * @param result Transform result.
 * @returns JSON-safe transform result.
 */
function serializeResult(result: CacheableTransformResult): SerializedTransformResult {
    return {
        code: result.code,
        transformed: result.transformed,
        usesRuntime: result.usesRuntime,
        usesMerge: result.usesMerge,
        usesSzcn: result.usesSzcn,
        usesSzPart: result.usesSzPart,
        usesColorVar: result.usesColorVar,
        classes: [...result.classes],
        rawClassNames: [...result.rawClassNames],
        diagnostics: [...result.diagnostics],
        recoveryTokens: [...result.recoveryTokens],
        cssVariableMap: [...(result.cssVariableMap ?? new Map())],
    };
}

/**
 * Rehydrate JSON arrays back into Set/Map fields.
 *
 * @param result Serialized transform result.
 * @returns Cacheable transform result.
 */
function deserializeResult(result: SerializedTransformResult): CacheableTransformResult {
    return {
        code: result.code,
        transformed: result.transformed,
        usesRuntime: result.usesRuntime,
        usesMerge: result.usesMerge,
        usesSzcn: result.usesSzcn,
        usesSzPart: result.usesSzPart,
        usesColorVar: result.usesColorVar,
        classes: new Set(result.classes),
        rawClassNames: new Set(result.rawClassNames),
        diagnostics: [...result.diagnostics],
        recoveryTokens: new Map(result.recoveryTokens),
        cssVariableMap: new Map(result.cssVariableMap ?? []),
    };
}

/**
 * Sort and dedupe alias pairs so cache identity is stable across Map/object
 * insertion order differences.
 *
 * @param aliases Original-to-alias custom-property pairs.
 * @returns Stable alias entries for cache keys and entries.
 */
function normalizeGlobalVarAliasEntries(
    aliases: TransformCacheKeyInput['globalVarAliases'],
): Array<[string, string]> {
    if (!aliases || aliases.length === 0) {
        return [];
    }

    const normalized = new Map<string, string>();
    for (const [original, alias] of aliases) {
        if (typeof original === 'string' && typeof alias === 'string') {
            normalized.set(original, alias);
        }
    }
    return [...normalized].sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Compare normalized alias entries.
 *
 * @param left Cached alias entries.
 * @param right Current normalized alias entries.
 * @returns Whether both alias tables are identical.
 */
function sameGlobalVarAliases(
    left: TransformCacheEntry['globalVarAliases'] | undefined,
    right: Array<[string, string]>,
): boolean {
    if (!Array.isArray(left) || left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < left.length; index++) {
        const leftEntry = left[index];
        const rightEntry = right[index];
        if (leftEntry?.[0] !== rightEntry?.[0] || leftEntry?.[1] !== rightEntry?.[1]) {
            return false;
        }
    }
    return true;
}

/**
 * Recursively list JSON files below a directory.
 *
 * @param dir Directory to scan.
 * @returns Absolute JSON file paths.
 */
function listJsonFiles(dir: string): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listJsonFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            files.push(fullPath);
        }
    }
    return files;
}

/**
 * Evicts oldest-first from an insertion-ordered in-memory result cache until it
 * fits BOTH budgets: entry count and total retained code characters. Entry
 * count alone is not a memory bound — each entry keeps the full transformed
 * code string, so a fixed 1000-entry cap could retain hundreds of MB of large
 * generated files in a long-lived dev server. Always leaves at least one entry
 * so a single oversized file still gets its cache hit.
 *
 * @param cache - Insertion-ordered cache (oldest entry first).
 * @param totalCodeChars - Current sum of `code.length` across entries.
 * @param maxEntries - Entry-count budget.
 * @param maxCodeChars - Retained-code budget in characters.
 * @returns The updated total code characters after eviction.
 */
export function evictMemoryCacheToBudget(
    cache: Map<string, { code: string }>,
    totalCodeChars: number,
    maxEntries: number,
    maxCodeChars: number,
): number {
    let total = totalCodeChars;
    while (cache.size > maxEntries || (total > maxCodeChars && cache.size > 1)) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        const evicted = cache.get(oldest);
        cache.delete(oldest);
        total -= evicted?.code.length ?? 0;
    }
    return total;
}
