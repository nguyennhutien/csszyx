/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import { createHash } from 'node:crypto';
import * as path from 'node:path';

import type { TransformSourceCodeOptions } from '@csszyx/compiler';

import { insertAfterUseDirective } from './directive-prologue.js';
import type { JsonLike } from './next-cache-identity.js';
import {
    configWithImportedStaticSz,
    normalizeProviderPaths,
    resolveNextCrossModule,
    withCrossModuleStatics,
} from './next-cross-module.js';
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
import { normalizePathSeparators } from './path-normalization.js';
import { ensureThemeGroupsFile, themeGroupsSpecifier } from './theme-groups-file.js';
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
    /**
     * Whether a plain exported sz object may be compiled into its importers.
     *
     * The same opt-in the other lanes spell `build.importedStaticSz`, and it
     * has to be given to `csszyx next prebuild` too — the prebuild is what
     * safelists the classes the loader then emits, so a lane that resolves
     * more than the other would emit class names with no rule behind them.
     */
    importedStaticSz?: boolean;
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
        config: configWithImportedStaticSz(options.config ?? {}, options.importedStaticSz),
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

    // Cross-module resolution, inverted for this lane: no prescan hands the
    // loader a registry, so it reads each provider from disk itself. Every one
    // it read is declared below — an edited style module has to invalidate its
    // importers, or they keep compiling against the value it used to have.
    const crossModule = resolveNextCrossModule({
        filename: loaderContext.resourcePath,
        source,
        root: context.root,
        importedStaticSz: options.importedStaticSz,
    });
    const transform = transformNextSource({
        source,
        filename: loaderContext.resourcePath,
        parserMode: options.parserMode ?? 'rust',
        compilerOptions: withCrossModuleStatics(options.compilerOptions, crossModule.statics),
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
    // szcn theme groups. The other lanes import a virtual module the plugin
    // resolves; a loader cannot, so a real file is written once per project and
    // imported by path. Only modules that can call szcn pay for it, and the
    // import goes AFTER any `use client` directive, which must stay first.
    const callsSzcn = transform.result.usesSzcn || /\bszcn\s*\(/.test(source);
    const themeGroups = callsSzcn
        ? ensureThemeGroupsFile(context.root, path.join(context.root, '.csszyx'))
        : { file: null, watch: [] };
    // Turbopack forwards a loader's file dependencies to its watcher (its
    // webpack-loader bridge reports `fileDependencies` back over IPC), so
    // declaring the project's stylesheets here is what makes a `@theme` edit
    // regenerate the registration DURING a dev session instead of at the next
    // build. Only author-owned stylesheets are declared — never the generated
    // module, which the loader itself writes.
    for (const stylesheet of themeGroups.watch) loaderContext.addDependency?.(stylesheet);
    // The other half of cross-module resolution. Turbopack forwards these the
    // same way it forwards the stylesheets above, so editing a style module
    // re-runs the loader for every file that read it.
    for (const provider of normalizeProviderPaths(crossModule.providers)) {
        loaderContext.addDependency?.(provider);
    }
    const code =
        themeGroups.file === null
            ? injected.code
            : insertAfterUseDirective(
                  injected.code,
                  `import '${themeGroupsSpecifier(loaderContext.resourcePath, themeGroups.file)}';\n`,
              );
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
    // converges because Turbopack content-hash-dedupes the loader output. None
    // of them is registered; Tailwind v4's PostCSS `@source` watcher picks up
    // the safelist file independently.
    //
    // The stylesheets above are the opposite case and ARE registered: they are
    // author-owned INPUTS the emitted code genuinely depends on, not outputs
    // this loader rewrites, so watching them converges instead of cascading.
    return {
        code,
        context,
        transform,
        shardPath,
        materialized,
        dependencies: themeGroups.watch,
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
            [
                `[csszyx] Next Turbopack production cache is not ready for ${context.root}: ${validation.reason}.`,
                'Production builds with Turbopack need the csszyx safelist seeded first:',
                '',
                "  npx csszyx next prebuild 'app/**/*.tsx'",
                '',
                'Wire it into package.json so plain builds keep working:',
                '',
                '  "build": "csszyx next prebuild \'app/**/*.tsx\' && next build"',
                '',
                'Docs: https://csszyx.com/docs/installation#nextjs-turbopack-setup',
            ].join('\n'),
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
        .update(normalizePathSeparators(path.relative(context.root, metadata.sourcePath)))
        .digest('hex');
}
