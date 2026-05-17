import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TokenData } from '@csszyx/compiler';

const CACHE_SCHEMA_VERSION = 1;

/** Transform result shape that can be serialized into the on-disk cache. */
export interface CacheableTransformResult {
    /** Transformed source code. */
    code: string;
    /** Whether csszyx changed the source. */
    transformed: boolean;
    /** Whether the source needs the _sz runtime helper. */
    usesRuntime: boolean;
    /** Whether the source needs the _szMerge runtime helper. */
    usesMerge: boolean;
    /** Whether the source needs the color-var runtime helper. */
    usesColorVar: boolean;
    /** Classes generated from sz syntax. */
    classes: Set<string>;
    /** Raw className/class strings collected for Tailwind discovery only. */
    rawClassNames: Set<string>;
    /** Compiler diagnostics to replay on cache hit. */
    diagnostics: string[];
    /** Recovery tokens emitted by szRecover attributes. */
    recoveryTokens: Map<string, TokenData>;
}

/** JSON-safe transform result stored inside a cache entry. */
interface SerializedTransformResult {
    code: string;
    transformed: boolean;
    usesRuntime: boolean;
    usesMerge: boolean;
    usesColorVar: boolean;
    classes: string[];
    rawClassNames: string[];
    diagnostics: string[];
    recoveryTokens: Array<[string, TokenData]>;
}

/** On-disk transform cache entry schema. */
interface TransformCacheEntry {
    version: number;
    pluginVersion: string;
    compilerVersion: string;
    parserMode: string;
    astBudget: number | null;
    filename: string;
    inputSha256: string;
    timestamp: string;
    result: SerializedTransformResult;
}

/** Inputs that affect transform cache identity. */
export interface TransformCacheKeyInput {
    /** @csszyx/unplugin package version. */
    pluginVersion: string;
    /** @csszyx/compiler package version. */
    compilerVersion: string;
    /** Active parser mode. */
    parserMode: string;
    /** Effective AST budget override, if configured. */
    astBudget?: number;
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
    const keyMaterial = [
        `schema=${CACHE_SCHEMA_VERSION}`,
        `plugin=${input.pluginVersion}`,
        `compiler=${input.compilerVersion}`,
        `parser=${input.parserMode}`,
        `astBudget=${input.astBudget ?? 'default'}`,
        `filename=${normalizeFilename(input.filename)}`,
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
 * @returns Cached transform result, or null on miss/corruption.
 */
export function readTransformCache(
    cacheRoot: string,
    input: TransformCacheKeyInput,
): CacheableTransformResult | null {
    const { key, inputSha256 } = createTransformCacheKey(input);
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
        entry.parserMode !== input.parserMode ||
        entry.astBudget !== (input.astBudget ?? null) ||
        entry.filename !== normalizeFilename(input.filename) ||
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
 */
export function writeTransformCache(
    cacheRoot: string,
    input: TransformCacheKeyInput,
    result: CacheableTransformResult,
): void {
    const { key, inputSha256 } = createTransformCacheKey(input);
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
        parserMode: input.parserMode,
        astBudget: input.astBudget ?? null,
        filename: normalizeFilename(input.filename),
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
 * Delete transform cache entries older than a threshold.
 *
 * @param cacheRoot Absolute transform cache directory.
 * @param maxAgeMs Maximum entry age in milliseconds.
 * @param now Current timestamp for deterministic tests.
 * @returns Number of deleted files.
 */
export function evictOldTransformCacheEntries(
    cacheRoot: string,
    maxAgeMs: number,
    now: number = Date.now(),
): number {
    let deleted = 0;
    for (const file of listJsonFiles(cacheRoot)) {
        try {
            const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<TransformCacheEntry>;
            const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : 0;
            if (!Number.isFinite(timestamp) || now - timestamp > maxAgeMs) {
                fs.rmSync(file, { force: true });
                deleted++;
            }
        } catch {
            fs.rmSync(file, { force: true });
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
 * Normalize path separators for cross-platform cache keys.
 *
 * @param filename Source filename.
 * @returns Filename with POSIX separators.
 */
function normalizeFilename(filename: string): string {
    return filename.replace(/\\/g, '/');
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
        usesColorVar: result.usesColorVar,
        classes: [...result.classes],
        rawClassNames: [...result.rawClassNames],
        diagnostics: [...result.diagnostics],
        recoveryTokens: [...result.recoveryTokens],
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
        usesColorVar: result.usesColorVar,
        classes: new Set(result.classes),
        rawClassNames: new Set(result.rawClassNames),
        diagnostics: [...result.diagnostics],
        recoveryTokens: new Map(result.recoveryTokens),
    };
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
