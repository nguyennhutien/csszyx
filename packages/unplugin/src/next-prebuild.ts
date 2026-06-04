/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import type { TransformSourceCodeOptions } from '@csszyx/compiler';

import type { JsonLike } from './next-cache-identity.js';
import { type AtomicWriteOptions, writeNextSafelistShard } from './next-safelist-state.js';
import {
    type NextSourceParserMode,
    type NextSourceTransformOutput,
    transformNextSource,
} from './next-source-transformer.js';
import { createNextStateContext, type NextStateContext } from './next-state-context.js';
import {
    collectNextTransformMetadata,
    createNextSafelistShardFromMetadata,
    type NextTransformMetadata,
} from './next-transform-metadata.js';
import { type NextWatcherCycleResult, runNextWatcherCycle } from './next-watcher-cycle.js';
import { resolveTransformCacheDir } from './transform-cache.js';

/** Serializable options accepted by the Next Turbopack csszyx prebuild core. */
export interface NextPrebuildOptions {
    files: readonly string[];
    explicitRoot?: string;
    loaderRootContext?: string;
    loaderContext?: string;
    cwd?: string;
    cacheDir?: string;
    safelistOutputFile?: string;
    parserMode?: NextSourceParserMode;
    compilerOptions?: TransformSourceCodeOptions;
    config?: JsonLike;
    env?: Record<string, string | undefined>;
    envKeys?: readonly string[];
    nextVersion: string;
    csszyxVersion: string;
    compilerVersion: string;
    nativeVersion: string;
    mode?: 'development' | 'production';
    astBudget?: number;
    allowBabelFallback?: boolean;
    allowProductionMangling?: boolean;
    writeOptions?: AtomicWriteOptions;
    createdAt?: string;
}

/** Per-file result captured by one prebuild pass. */
export interface NextPrebuildFileResult {
    filename: string;
    shardPath: string | null;
    classCount: number;
    cacheStatus: NextSourceTransformOutput['cacheStatus'];
    producer: NextSourceTransformOutput['producer'];
}

/** Aggregated result returned by `runNextPrebuild`. */
export interface NextPrebuildResult {
    context: NextStateContext;
    scannedCount: number;
    transformedCount: number;
    skippedMissingCount: number;
    classCount: number;
    sourceCount: number;
    manifestPath: string;
    safelistOutputPath: string;
    files: NextPrebuildFileResult[];
    cycle: NextWatcherCycleResult;
}

/**
 * Run one synchronous Next Turbopack csszyx prebuild pass.
 *
 * The prebuild walks an explicit file list, reuses the same state, transform,
 * metadata, shard, and materialization contract as the loader, and finalizes
 * the canonical Tailwind safelist plus a completed generation manifest. It
 * intentionally does not own glob/chokidar dependencies or a CLI surface yet.
 *
 * @param options Prebuild input options.
 * @returns Summary covering scanned/transformed counts and materialization paths.
 */
export function runNextPrebuild(options: NextPrebuildOptions): NextPrebuildResult {
    assertProductionManglingBoundary(options);

    const context = createNextStateContext({
        explicitRoot: options.explicitRoot,
        loaderRootContext: options.loaderRootContext,
        loaderContext: options.loaderContext,
        cwd: options.cwd,
        cacheDir: options.cacheDir,
        safelistOutputFile: options.safelistOutputFile,
        config: options.config ?? {},
        env: options.env ?? process.env,
        envKeys: options.envKeys,
        nextVersion: options.nextVersion,
        csszyxVersion: options.csszyxVersion,
        nativeVersion: options.nativeVersion,
        mode: options.mode ?? 'production',
    });

    const cacheRoot = resolveTransformCacheDir(
        context.root,
        path.relative(context.root, context.cacheDir),
    );

    const files: NextPrebuildFileResult[] = [];
    let scannedCount = 0;
    let transformedCount = 0;
    let skippedMissingCount = 0;

    for (const filename of uniqueFiles(options.files)) {
        scannedCount++;
        if (!existsSync(filename)) {
            skippedMissingCount++;
            continue;
        }

        const source = readFileSync(filename, 'utf8');
        const transform = transformNextSource({
            source,
            filename,
            parserMode: options.parserMode ?? 'rust',
            compilerOptions: options.compilerOptions,
            cacheRoot,
            pluginVersion: options.csszyxVersion,
            compilerVersion: options.compilerVersion,
            astBudget: options.astBudget,
            allowBabelFallback: options.allowBabelFallback,
        });

        const metadata = collectNextTransformMetadata(transform.result, source, filename);
        transformedCount++;

        let shardPath: string | null = null;
        if (metadata.classes.length > 0) {
            const shardResult = writeNextSafelistShard(
                context.safelist.shardsDir,
                createNextSafelistShardFromMetadata(
                    metadata,
                    createShardCacheKey(context, metadata),
                ),
                options.writeOptions,
            );
            shardPath = shardResult.filePath;
        }

        files.push({
            filename,
            shardPath,
            classCount: metadata.classes.length,
            cacheStatus: transform.cacheStatus,
            producer: transform.producer,
        });
    }

    const cycle = runNextWatcherCycle(context, {
        writeOptions: options.writeOptions,
        lockOptions: {
            root: context.root,
            mode: context.manifestExpectation.mode,
            command: 'csszyx next prebuild',
        },
        createdAt: options.createdAt,
    });

    return {
        context,
        scannedCount,
        transformedCount,
        skippedMissingCount,
        classCount: cycle.materialize.classCount,
        sourceCount: cycle.materialize.sourceCount,
        manifestPath: context.manifestPath,
        safelistOutputPath: context.safelist.outputPath,
        files,
        cycle,
    };
}

/**
 *
 * @param options
 */
function assertProductionManglingBoundary(options: NextPrebuildOptions): void {
    if (options.allowProductionMangling) {
        return;
    }
    if ((options.mode ?? 'production') !== 'production') {
        return;
    }
    if (options.compilerOptions?.mangleVars === true || hasEnabledMangleVars(options.config)) {
        throw new Error(
            '[csszyx] Next prebuild does not support production CSS variable mangling. Use Next Webpack mode for full csszyx parity.',
        );
    }
}

/**
 *
 * @param config
 */
function hasEnabledMangleVars(config: JsonLike | undefined): boolean {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        return false;
    }
    return (config as { readonly mangleVars?: unknown }).mangleVars === true;
}

/**
 *
 * @param files
 */
function uniqueFiles(files: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const file of files) {
        const resolved = path.resolve(file);
        if (seen.has(resolved)) {
            continue;
        }
        seen.add(resolved);
        result.push(resolved);
    }
    return result;
}

/**
 *
 * @param context
 * @param metadata
 */
function createShardCacheKey(context: NextStateContext, metadata: NextTransformMetadata): string {
    return createHash('sha256')
        .update(context.identity.generation)
        .update('\0')
        .update(path.relative(context.root, metadata.sourcePath).replace(/\\/g, '/'))
        .update('\0')
        .update(metadata.sourceHash)
        .digest('hex');
}
