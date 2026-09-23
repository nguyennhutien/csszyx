/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { SourceTransformResult } from '@csszyx/compiler';
import { insertAfterUseDirective } from './directive-prologue.js';
import {
    callsSzcn as callsMergeHelper,
    ensureMergeRegistration,
    ensureMergeTable,
    importMergeRegistration,
    loadsCsszyxRuntime,
    mergeRegistrationPath,
    mergeTableFor,
    mergeTablePath,
} from './merge-registration.js';
import { mergeGroupsOf } from './merge-signature.js';
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
import type { NextLaneOptions } from './next-lane-options.js';
import { readPackageVersion } from './next-package-version.js';
import { injectNextRuntimeImports } from './next-runtime-injection.js';
import {
    NEXT_TURBO_LOADER_LOCK_COMMAND,
    NEXT_WATCH_LOCK_COMMAND,
    NextSafelistStateLockedError,
    writeNextSafelistShard,
} from './next-safelist-state.js';
import {
    type NextSourceTransformInput,
    type NextSourceTransformOutput,
    transformNextSource,
} from './next-source-transformer.js';
import { createNextStateContext, type NextStateContext } from './next-state-context.js';
import {
    type NextClassPrefix,
    projectStylesheetCandidates,
    recordedStylesheetIgnore,
    resolveNextClassPrefix,
    unreadNextPrefixMessage,
    writeNextStylesheetFacts,
} from './next-stylesheet-facts.js';
import {
    collectNextTransformMetadata,
    createNextSafelistShardFromMetadata,
} from './next-transform-metadata.js';
import { runNextWatcherCycle } from './next-watcher-cycle.js';
import { normalizePathSeparators } from './path-normalization.js';
import { ensureThemeGroupsFile, themeGroupsSpecifier } from './theme-groups-file.js';
import { resolveTransformCacheDir } from './transform-cache.js';

/** Serializable options accepted by the Next Turbopack csszyx loader. */
export interface NextTurboLoaderOptions extends NextLaneOptions {
    root?: string;
    materializeSafelist?: boolean;
    /**
     * Whether a plain exported sz object may be compiled into its importers.
     *
     * The same setting the other lanes spell `build.importedStaticSz`, on
     * unless given, and `csszyx next prebuild` has to resolve it identically —
     * the prebuild is what safelists the classes the loader then emits, so a
     * lane that resolves more than the other would emit class names with no
     * rule behind them.
     */
    importedStaticSz?: boolean;
    /**
     * Whether a later `sz` key replaces an earlier one whose CSS it covers,
     * as the other lanes spell `build.mergeCoveredKeys`. On unless given.
     */
    mergeCoveredKeys?: boolean;
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
    /** Loader-runner compilation identity; changes when an input invalidates the build. */
    _compilation?: object;
    /** Turns the call asynchronous and returns the callback that completes it. */
    async?: () => (error: Error | null, code?: string, map?: unknown) => void;
    callback?: (error: Error | null, code?: string, map?: unknown) => void;
}

/** Prefix answers already validated inside one loader-runner compilation. */
const prefixesByCompilation = new WeakMap<object, Map<string, NextClassPrefix>>();

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
 * Merge a later `sz` key over an earlier one it covers, under Turbopack.
 *
 * A loader lowers one module at a time and cannot compile the project's CSS,
 * so which class covers which is read from the table `csszyx next prebuild` or
 * `csszyx next watch` settled. The module depends on that file whatever it
 * holds, so the first write re-runs this loader.
 *
 * The first pass is what the cache and the shard keep: the next table is built
 * from the classes before any merge, and one built from the merged classes
 * would lose the pair that removed a class, so the run after it would keep
 * both again.
 *
 * @param first - What the first pass returned.
 * @param transformInput - The input that pass ran with.
 * @param context - The resolved loader context of this project.
 * @param loaderContext - Turbopack's loader context, for the dependency.
 * @returns The merged result, or the first pass when nothing merges.
 */
function withNextObjectRule(
    first: SourceTransformResult,
    transformInput: NextSourceTransformInput,
    context: NextStateContext,
    loaderContext: NextTurboLoaderContext,
): SourceTransformResult {
    const groups = mergeGroupsOf(first);
    if (groups.length === 0) return first;
    ensureMergeTable(context.root);
    loaderContext.addDependency?.(mergeTablePath(context.root));
    const mergeTable = mergeTableFor(context.root, groups);
    if (mergeTable === null) return first;
    return transformNextSource({
        ...transformInput,
        compilerOptions: { ...transformInput.compilerOptions, mergeTable },
        cacheRoot: undefined,
    }).result;
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

    const tailwindStylesheet = [options.tailwindStylesheet ?? []].flat();
    const prefix = prefixForCompilation(context, tailwindStylesheet, loaderContext._compilation);
    if (!prefix.ok) {
        throw new NextStylesheetFactsPending(
            unreadNextPrefixMessage(context.root, prefix.reason, 'the Next Turbopack loader'),
            {
                root: context.root,
                cacheDir: context.cacheDir,
                tailwindStylesheet,
                mode: context.manifestExpectation.mode,
            },
        );
    }
    // The facts file and every stylesheet it records: an edit to any of them
    // re-runs this loader, which is how a prefix change reaches a dev session.
    for (const file of prefix.dependencies) loaderContext.addDependency?.(file);

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
    const transformInput = {
        source,
        filename: loaderContext.resourcePath,
        parserMode: options.parserMode ?? 'rust',
        compilerOptions: {
            ...withCrossModuleStatics(options.compilerOptions, crossModule.statics),
            classPrefix: prefix.prefix,
        },
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
    };
    const transform = transformNextSource(transformInput);
    const lowered =
        options.mergeCoveredKeys === false
            ? transform.result
            : withNextObjectRule(transform.result, transformInput, context, loaderContext);
    const injected = injectNextRuntimeImports(lowered.code, lowered, prefix.prefix);
    // szcn theme groups. The other lanes import a virtual module the plugin
    // resolves; a loader cannot, so a real file is written once per project and
    // imported by path. Only modules that can call szcn pay for it, and the
    // import goes AFTER any `use client` directive, which must stay first.
    const callsSzcn = callsMergeHelper(source, lowered);
    const themeGroups = callsSzcn
        ? ensureThemeGroupsFile(
              context.root,
              path.join(context.root, '.csszyx'),
              recordedStylesheetIgnore(context.root, context.cacheDir),
          )
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
    let code =
        themeGroups.file === null
            ? injected.code
            : insertAfterUseDirective(
                  injected.code,
                  `import '${themeGroupsSpecifier(loaderContext.resourcePath, themeGroups.file)}';\n`,
              );
    // The merge table and the unserved list, settled by `csszyx next prebuild`
    // or `csszyx next watch`, since only they can compile the project's CSS. A
    // module that loads the runtime imports the file by path and depends on
    // it, so a rewrite by the watcher re-runs the loader here. Not only one
    // that calls `szcn`: a `cn` helper re-exporting it is the only module that
    // names it.
    if (loadsCsszyxRuntime(code)) {
        ensureMergeRegistration(context.root);
        const registration = importMergeRegistration(
            code,
            loaderContext.resourcePath,
            context.root,
        );
        code = registration.code;
        // On the path, not on what was imported: a module whose table could not
        // be written yet still re-runs when a Next command writes it.
        loaderContext.addDependency?.(mergeRegistrationPath(context.root));
    }
    const metadata = collectNextTransformMetadata(
        transform.result,
        source,
        loaderContext.resourcePath,
    );
    let materialized = false;

    const shardResult = writeNextSafelistShard(
        context.safelist.shardsDir,
        createNextSafelistShardFromMetadata(metadata, createShardCacheKey(context, metadata)),
        options.writeOptions,
    );
    const shardPath = shardResult.filePath;

    // The shard path is canonical for (generation, source path), while
    // `sourceHash` determines whether its contents need replacement. This
    // prevents one source edit from leaving multiple timestamp-ordered shards
    // behind. When `changed === false` the on-disk shard already matches the
    // result we would produce, which means the safelist is already up to date
    // for this file. Empty class sets are still written so removing the last
    // `sz` prop actively removes that file's old classes.
    if (options.materializeSafelist !== false && shardResult.changed) {
        try {
            runNextWatcherCycle(context, {
                writeOptions: options.writeOptions,
                lockOptions: {
                    root: context.root,
                    mode: context.manifestExpectation.mode,
                    command: NEXT_TURBO_LOADER_LOCK_COMMAND,
                },
            });
            materialized = true;
        } catch (error) {
            // A watcher holding this lock is not a conflict. The shard above is
            // already on disk, the watcher is driven by shard filesystem events
            // rather than source ones, and materializing reads every shard — so
            // the write that lost the race is the write that wakes the winner,
            // and the winner's pass will include it. Yielding here is the
            // shorter path to the same state.
            //
            // The documented Next setup runs `csszyx next watch` beside
            // `next dev`, so this overlap is the normal case rather than an
            // edge one. The critical section is under a millisecond, which is
            // exactly why it went unnoticed until a loaded CI runner landed
            // inside it and the page stopped compiling.
            //
            // Any other holder still throws: two loaders in one cycle means
            // something is wrong, and that has to stay loud.
            if (
                !(error instanceof NextSafelistStateLockedError) ||
                error.holder.command !== NEXT_WATCH_LOCK_COMMAND
            ) {
                throw error;
            }
        }
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
 * Resolve stylesheet facts once inside a loader-runner compilation.
 *
 * The compilation object is the invalidation epoch: every recorded dependency
 * is still registered for every module, and an edit creates a new compilation
 * whose first module validates the record again. Contexts without that object
 * take the uncached path so an unknown loader runner cannot retain stale facts.
 * Failed answers are never cached, allowing the async development fallback to
 * write facts and retry in the same compilation.
 *
 * For M modules and S recorded stylesheets, a supported compilation pays O(S)
 * synchronous validation once and O(1) lookup per later module, for O(S + M)
 * work and O(P) cached answers for P stylesheet selections. Build startup pays
 * this cost; each compilation object owns and releases its map through WeakMap.
 *
 * @param context - The resolved Next project paths.
 * @param tailwindStylesheet - Explicit roots, or none for project discovery.
 * @param compilation - The loader-runner invalidation epoch, when available.
 * @returns The prefix answer and dependencies for this project selection.
 */
function prefixForCompilation(
    context: NextStateContext,
    tailwindStylesheet: readonly string[],
    compilation: object | undefined,
): NextClassPrefix {
    const resolve = (): NextClassPrefix =>
        resolveNextClassPrefix({
            root: context.root,
            cacheDir: context.cacheDir,
            tailwindStylesheet,
            candidates:
                tailwindStylesheet.length > 0
                    ? undefined
                    : projectStylesheetCandidates(context.root, context.cacheDir),
        });
    if (compilation === undefined) return resolve();

    let cached = prefixesByCompilation.get(compilation);
    if (cached === undefined) {
        cached = new Map();
        prefixesByCompilation.set(compilation, cached);
    }
    const key = JSON.stringify([context.root, context.cacheDir, tailwindStylesheet]);
    const known = cached.get(key);
    if (known !== undefined) return known;

    const answer = resolve();
    if (answer.ok) cached.set(key, answer);
    return answer;
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
        // `next dev` without `csszyx next watch`: nothing has read the stylesheets,
        // and a dev loader may wait while it reads them itself. A production
        // build may not, because its prebuild owns the answer.
        if (
            error instanceof NextStylesheetFactsPending &&
            error.input.mode === 'development' &&
            this.async
        ) {
            const done = this.async();
            // A rejection reaches `done` as its error argument; the loader
            // runner reports whatever the read threw.
            readStylesheetsOnce(error.input).then(() => {
                const result = runNextTurboLoader(source, this);
                done(null, result.code, result.map);
            }, done);
            return;
        }
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

/** What a loader that found no usable facts needs in order to read the stylesheets. */
interface NextStylesheetFactsInput {
    root: string;
    cacheDir: string;
    tailwindStylesheet: string[];
    mode: 'development' | 'production';
}

/** A loader run that has no Tailwind prefix to lower with yet. */
class NextStylesheetFactsPending extends Error {
    readonly input: NextStylesheetFactsInput;

    /**
     * @param message - What the loader would report if nobody can wait.
     * @param input - What reading the stylesheets needs.
     */
    constructor(message: string, input: NextStylesheetFactsInput) {
        super(message);
        this.input = input;
    }
}

/** Reads in flight per cache directory, so modules loaded together share one compile. */
const stylesheetReads = new Map<string, Promise<void>>();

/**
 * Read the app's stylesheets and record the facts, once for every module that
 * asks at the same time.
 *
 * @param input - Where the app is and which stylesheets it loads.
 * @returns Nothing once the facts are written.
 */
function readStylesheetsOnce(input: NextStylesheetFactsInput): Promise<void> {
    const inFlight = stylesheetReads.get(input.cacheDir);
    if (inFlight !== undefined) return inFlight;
    const read = writeNextStylesheetFacts(input)
        .then(({ warning }) => {
            if (warning !== null) console.warn(warning);
        })
        .finally(() => stylesheetReads.delete(input.cacheDir));
    stylesheetReads.set(input.cacheDir, read);
    return read;
}
