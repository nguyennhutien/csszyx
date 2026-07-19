import * as path from 'node:path';

import { scanGlobalVarUsages } from '@csszyx/compiler';

import {
    createGlobalVarScanCacheKey,
    readGlobalVarScanCache,
    writeGlobalVarScanCache,
} from './global-var-cache.js';
import { scanGlobalVarCss } from './global-var-css-scan.js';
import { planGlobalVarAliases } from './global-var-planner.js';
import type {
    CreateGlobalVarAliasValidationOptionsInput,
    CssVarScanResult,
    GlobalVarAliasValidationResult,
    GlobalVarCssSource,
    ValidateGlobalVarAliasInputsOptions,
} from './global-var-types.js';

/**
 * Runs the Phase H pure validation pipeline without mutating build output.
 *
 * @param options Validation input.
 * @returns CSS scans, alias plan, and JS/JSX out-of-band diagnostics.
 */
export function validateGlobalVarAliasInputs(
    options: ValidateGlobalVarAliasInputsOptions,
): GlobalVarAliasValidationResult {
    const scans = options.cssFiles.map(file =>
        scanCssSourceWithOptionalCache(file, options.cacheDir),
    );
    const plan = planGlobalVarAliases({
        scans,
        tokens: options.tokens,
        autoPrefix: options.autoPrefix,
        aliasPrefix: options.aliasPrefix,
        reserved: options.reserved,
    });
    if (plan.diagnostics.length > 0 || plan.entries.length === 0) {
        return { scans, plan, usageDiagnostics: [] };
    }

    const candidateTokens = plan.entries.map(entry => entry.original);
    const usageDiagnostics = (options.sourceFiles ?? []).flatMap(file =>
        scanGlobalVarUsages(file.code, file.filePath, { tokens: candidateTokens }),
    );

    return { scans, plan, usageDiagnostics };
}

/**
 * Builds validation options from bundler CSS assets and observed source files.
 *
 * This keeps production hook wiring deterministic: the same normalized CSS asset
 * inventory can feed fail-closed validation before any CSS/TSX rewrite mutates
 * output.
 *
 * @param input Bundler output and user global-var alias config fields.
 * @returns Normalized validation options.
 */
export function createGlobalVarAliasValidationOptions(
    input: CreateGlobalVarAliasValidationOptionsInput,
): ValidateGlobalVarAliasInputsOptions {
    return {
        cssFiles: input.cssAssets
            .filter(asset => /\.css(?:$|\?)/.test(asset.fileName))
            .map(asset => ({
                filePath: normalizeBuildAssetPath(input.rootDir, asset.fileName),
                css: cssAssetSourceToString(asset.source),
                mtimeMs: asset.mtimeMs,
            })),
        sourceFiles: input.sourceFiles ?? [],
        tokens: input.tokens,
        autoPrefix: input.autoPrefix,
        aliasPrefix: input.aliasPrefix,
        reserved: input.reserved,
        cacheDir: input.cacheDir,
    };
}

/**
 * Scans one CSS source with optional cache support.
 *
 * @param file CSS source.
 * @param cacheDir Optional global-var scan cache directory.
 * @returns CSS variable scan result.
 */
function scanCssSourceWithOptionalCache(
    file: GlobalVarCssSource,
    cacheDir: string | undefined,
): CssVarScanResult {
    if (cacheDir === undefined || file.mtimeMs === undefined) {
        return scanGlobalVarCss(file.css, { filePath: file.filePath });
    }

    const key = createGlobalVarScanCacheKey({
        filePath: file.filePath,
        css: file.css,
        mtimeMs: file.mtimeMs,
    });
    const cached = readGlobalVarScanCache(cacheDir, key);
    if (cached) {
        return cached;
    }

    const result = scanGlobalVarCss(file.css, { filePath: file.filePath });
    writeGlobalVarScanCache(cacheDir, key, result);
    return result;
}

/**
 * Normalizes a build asset name to an absolute diagnostic path.
 *
 * @param rootDir Project root.
 * @param fileName Asset file name from the bundler.
 * @returns Absolute normalized file path.
 */
function normalizeBuildAssetPath(rootDir: string, fileName: string): string {
    return (path.isAbsolute(fileName) ? fileName : path.join(rootDir, fileName)).replaceAll(
        '\\',
        '/',
    );
}

/**
 * Converts a CSS asset source into UTF-8 text.
 *
 * @param source Bundler asset source.
 * @returns CSS source text.
 */
function cssAssetSourceToString(source: string | Uint8Array): string {
    return typeof source === 'string' ? source : Buffer.from(source).toString('utf8');
}
