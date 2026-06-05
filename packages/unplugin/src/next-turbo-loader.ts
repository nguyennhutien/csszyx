/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import { createHash } from 'node:crypto';
import * as path from 'node:path';

import type { TransformSourceCodeOptions } from '@csszyx/compiler';

import type { JsonLike } from './next-cache-identity.js';
import {
    readNextGenerationManifest,
    validateNextGenerationManifest,
} from './next-generation-manifest.js';
import { readPackageVersion } from './next-package-version.js';
import { injectNextRuntimeImports } from './next-runtime-injection.js';
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
} from './next-transform-metadata.js';
import { runNextWatcherCycle } from './next-watcher-cycle.js';
import { resolveTransformCacheDir } from './transform-cache.js';

/** Serializable options accepted by the Next Turbopack csszyx loader. */
export interface NextTurboLoaderOptions {
    root?: string;
    cacheDir?: string;
    safelistOutputFile?: string;
    parserMode?: NextSourceParserMode;
    compilerOptions?: TransformSourceCodeOptions;
    config?: JsonLike;
    env?: Record<string, string | undefined>;
    envKeys?: readonly string[];
    nextVersion?: string;
    csszyxVersion?: string;
    compilerVersion?: string;
    nativeVersion?: string;
    mode?: 'development' | 'production';
    astBudget?: number;
    allowBabelFallback?: boolean;
    allowProductionMangling?: boolean;
    materializeSafelist?: boolean;
    writeOptions?: AtomicWriteOptions;
}

/** Minimal Webpack-compatible loader context used by Turbopack. */
export interface NextTurboLoaderContext {
    resourcePath: string;
    rootContext?: string;
    context?: string;
    mode?: string;
    query?: unknown;
    getOptions?: () => NextTurboLoaderOptions;
    addDependency?: (file: string) => void;
    callback?: (error: Error | null, code?: string, map?: unknown) => void;
}

/** Testable result produced by the loader core before callback adaptation. */
export interface NextTurboLoaderResult {
    code: string;
    map?: unknown;
    context: NextStateContext;
    transform: NextSourceTransformOutput;
    shardPath: string | null;
    materialized: boolean;
    dependencies: string[];
}

/**
 * Run the csszyx Next Turbopack loader as a pure, synchronous operation.
 *
 * @param source Source module contents.
 * @param loaderContext Webpack-compatible loader context from Turbopack.
 * @param explicitOptions Serializable loader options.
 * @returns Transformed code plus state metadata for tests and diagnostics.
 */
export function runNextTurboLoader(
    source: string,
    loaderContext: NextTurboLoaderContext,
    explicitOptions: NextTurboLoaderOptions = {},
): NextTurboLoaderResult {
    const options = normalizeOptions(loaderContext, explicitOptions);
    assertTurbopackMangleBoundary(options, loaderContext.resourcePath);

    const context = createNextStateContext({
        explicitRoot: options.root,
        loaderRootContext: loaderContext.rootContext,
        loaderContext: loaderContext.context,
        cacheDir: options.cacheDir,
        safelistOutputFile: options.safelistOutputFile,
        config: options.config ?? {},
        env: options.env ?? process.env,
        envKeys: options.envKeys,
        nextVersion: options.nextVersion ?? 'unknown-next',
        csszyxVersion:
            options.csszyxVersion ?? readPackageVersion('../package.json', import.meta.url),
        nativeVersion:
            options.nativeVersion ??
            options.compilerVersion ??
            readPackageVersion('../../compiler/package.json', import.meta.url),
        mode: options.mode ?? normalizeMode(loaderContext.mode),
    });

    assertProductionManifestReady(context, options);

    const transform = transformNextSource({
        source,
        filename: loaderContext.resourcePath,
        parserMode: options.parserMode ?? 'rust',
        compilerOptions: options.compilerOptions,
        cacheRoot: resolveTransformCacheDir(
            context.root,
            path.relative(context.root, context.cacheDir),
        ),
        pluginVersion:
            options.csszyxVersion ?? readPackageVersion('../package.json', import.meta.url),
        compilerVersion:
            options.compilerVersion ??
            readPackageVersion('../../compiler/package.json', import.meta.url),
        astBudget: options.astBudget,
        allowBabelFallback: options.allowBabelFallback,
    });
    const injected = injectNextRuntimeImports(transform.result.code, transform.result);
    const metadata = collectNextTransformMetadata(
        transform.result,
        source,
        loaderContext.resourcePath,
    );
    let shardPath: string | null = null;
    let materialized = false;

    const shardResult = writeNextSafelistShard(
        context.safelist.shardsDir,
        createNextSafelistShardFromMetadata(metadata, createShardCacheKey(context, metadata)),
        options.writeOptions,
    );
    shardPath = shardResult.filePath;

    // The shard path is canonical for (generation, source path), while
    // `sourceHash` determines whether its contents need replacement. This
    // prevents one source edit from leaving multiple timestamp-ordered shards
    // behind. When `changed === false` the on-disk shard already matches the
    // result we would produce, which means the safelist is already up to date
    // for this file. Empty class sets are still written so removing the last
    // `sz` prop actively removes that file's old classes.
    if (options.materializeSafelist !== false && shardResult.changed) {
        runNextWatcherCycle(context, {
            writeOptions: options.writeOptions,
            lockOptions: {
                root: context.root,
                mode: context.manifestExpectation.mode,
                command: 'csszyx next turbo-loader',
            },
        });
        materialized = true;
    }

    // The loader's transformed `code` is a pure function of `source` plus the
    // resolved csszyx config (which already feeds the generation identity).
    // It does not logically depend on the safelist output, the snapshot file,
    // or the generation manifest — those are side-effect outputs of the
    // materialization cycle. Registering them as Turbopack dependencies would
    // make every loader call invalidate every other loader call's cache as
    // soon as the cycle rewrites them, producing a re-run cascade that only
    // converges because Turbopack content-hash-dedupes the loader output. We
    // intentionally register no dependencies and let Tailwind v4's PostCSS
    // `@source` watcher pick up the safelist file independently.
    return {
        code: injected.code,
        context,
        transform,
        shardPath,
        materialized,
        dependencies: [],
    };
}

/**
 * Webpack-compatible loader entry consumed by Next `turbopack.rules`.
 *
 * @param this Loader context.
 * @param source Source module contents.
 * @returns Transformed source when callback mode is unavailable.
 */
export default function nextTurboLoader(
    this: NextTurboLoaderContext,
    source: string,
): string | undefined {
    try {
        const result = runNextTurboLoader(source, this);
        if (this.callback) {
            this.callback(null, result.code, result.map);
            return;
        }
        return result.code;
    } catch (error) {
        if (this.callback) {
            this.callback(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        throw error;
    }
}

/**
 *
 * @param loaderContext
 * @param explicitOptions
 */
function normalizeOptions(
    loaderContext: NextTurboLoaderContext,
    explicitOptions: NextTurboLoaderOptions,
): NextTurboLoaderOptions {
    const contextOptions = loaderContext.getOptions?.() ?? parseQueryOptions(loaderContext.query);
    return { ...contextOptions, ...explicitOptions };
}

/**
 *
 * @param query
 */
function parseQueryOptions(query: unknown): NextTurboLoaderOptions {
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
        return {};
    }
    return query as NextTurboLoaderOptions;
}

/**
 *
 * @param mode
 */
function normalizeMode(mode: string | undefined): 'development' | 'production' {
    return mode === 'production' || process.env.NODE_ENV === 'production'
        ? 'production'
        : 'development';
}

/**
 *
 * @param context
 * @param options
 */
function assertProductionManifestReady(
    context: NextStateContext,
    options: NextTurboLoaderOptions,
): void {
    if ((options.mode ?? context.manifestExpectation.mode) !== 'production') {
        return;
    }
    const validation = validateNextGenerationManifest(
        readNextGenerationManifest(context.manifestPath),
        context.manifestExpectation,
    );
    if (!validation.ok) {
        throw new Error(
            `[csszyx] Next Turbopack production cache is not ready for ${context.root}: ${validation.reason}. Run csszyx next prebuild before next build --turbo.`,
        );
    }
}

/**
 *
 * @param options
 * @param resourcePath
 */
function assertTurbopackMangleBoundary(
    options: NextTurboLoaderOptions,
    resourcePath: string,
): void {
    if (options.allowProductionMangling) {
        return;
    }
    const productionMode = options.mode === 'production' || process.env.NODE_ENV === 'production';
    if (!productionMode) {
        return;
    }
    if (options.compilerOptions?.mangleVars === true || hasEnabledMangleVars(options.config)) {
        throw new Error(
            `[csszyx] Next Turbopack does not support production CSS variable mangling for ${resourcePath}. Use Next Webpack mode for full csszyx parity.`,
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
 * @param context
 * @param metadata
 */
function createShardCacheKey(
    context: NextStateContext,
    metadata: ReturnType<typeof collectNextTransformMetadata>,
): string {
    return createHash('sha256')
        .update(context.identity.generation)
        .update('\0')
        .update(path.relative(context.root, metadata.sourcePath).replace(/\\/g, '/'))
        .digest('hex');
}
