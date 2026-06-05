import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
    CssVarScanResult,
    GlobalVarScanCacheEntry,
    GlobalVarScanCacheKeyInput,
} from './global-var-types.js';

/**
 * Resolves the global variable scan cache directory.
 *
 * @param cacheDir csszyx cache root.
 * @returns Cache directory for Phase H CSS scans.
 */
export function resolveGlobalVarScanCacheDir(cacheDir: string): string {
    return path.join(cacheDir, 'global-vars');
}

/**
 * Creates a cache key from file path, mtime, and content hash.
 *
 * @param input Cache key input.
 * @returns Stable SHA-256 cache key.
 */
export function createGlobalVarScanCacheKey(input: GlobalVarScanCacheKeyInput): string {
    const hash = createHash('sha256');
    hash.update(input.filePath);
    hash.update('\0');
    hash.update(String(input.mtimeMs));
    hash.update('\0');
    hash.update(createHash('sha256').update(input.css).digest('hex'));
    return hash.digest('hex');
}

/**
 * Reads a cached global variable scan result when the key matches.
 *
 * @param cacheDir Global variable scan cache directory.
 * @param key Expected cache key.
 * @returns Cached scan result, or null on miss/corruption.
 */
export function readGlobalVarScanCache(cacheDir: string, key: string): CssVarScanResult | null {
    try {
        const raw = fs.readFileSync(globalVarScanCacheFile(cacheDir, key), 'utf8');
        const entry = JSON.parse(raw) as Partial<GlobalVarScanCacheEntry>;
        if (entry.key !== key || !entry.result) {
            return null;
        }
        return entry.result;
    } catch {
        return null;
    }
}

/**
 * Writes a global variable scan result cache entry.
 *
 * @param cacheDir Global variable scan cache directory.
 * @param key Cache key.
 * @param result Scan result to cache.
 */
export function writeGlobalVarScanCache(
    cacheDir: string,
    key: string,
    result: CssVarScanResult,
): void {
    // The scan cache is a build-time optimization, not a correctness input
    // (reads already fall back to a fresh scan). A read-only or otherwise
    // unwritable cache directory must not fail the build, so writes stay
    // best-effort and mirror readGlobalVarScanCache's silent recovery.
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            globalVarScanCacheFile(cacheDir, key),
            JSON.stringify({ key, result } satisfies GlobalVarScanCacheEntry),
            'utf8',
        );
    } catch {
        // Ignore cache write failures; the next scan recomputes the result.
    }
}

/**
 * Builds the file path for one scan cache entry.
 *
 * @param cacheDir Global variable scan cache directory.
 * @param key Cache key.
 * @returns Absolute or relative cache entry path.
 */
function globalVarScanCacheFile(cacheDir: string, key: string): string {
    return path.join(cacheDir, `${key}.json`);
}
