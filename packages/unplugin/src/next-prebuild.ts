/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { diagnosticError } from './diagnostic-message.js';
import { configWithImportedStaticSz, resolveNextCrossModule } from './next-cross-module.js';
import { assertNextMangleBoundary, type NextLaneOptions } from './next-lane-options.js';
import { readPackageVersion } from './next-package-version.js';
import { NEXT_PREBUILD_LOCK_COMMAND, writeNextSafelistShard } from './next-safelist-state.js';
import {
    type NextSourceTransformOutput,
    nextCompilerOptions,
    transformNextSource,
} from './next-source-transformer.js';
import { createNextStateContext, type NextStateContext } from './next-state-context.js';
import { resolveNextClassPrefix } from './next-stylesheet-facts.js';
import { projectRelative } from './path-case.js';
import { assertRuntimeMatchesPlugin } from './runtime-version.js';

// The CLI records the stylesheet facts before it calls the prebuild, through the
// same entry it already imports the prebuild from.
export {
    auditMerges,
    MERGE_AUDIT_KINDS,
    type MergeAuditFile,
    type MergeAuditFinding,
    type MergeAuditKind,
} from './merge-audit.js';
export {
    MERGE_REGISTRATION_FILE,
    type MergeRegistrationInput,
    writeMergeRegistration,
} from './merge-registration.js';
export { openStylesheetModel, prepareNextStylesheetFacts } from './next-stylesheet-facts.js';
// The CLI prunes its source watcher with the matcher the loader filters its
// stylesheet walk with, so one pattern reads the same in both.
export { createRootIgnoreMatcher, type RootIgnoreMatcher } from './root-ignore-matcher.js';

import {
    collectNextTransformMetadata,
    createNextSafelistShardFromMetadata,
    type NextTransformMetadata,
} from './next-transform-metadata.js';
import { type NextWatcherCycleResult, runNextWatcherCycle } from './next-watcher-cycle.js';
import { normalizePathSeparators } from './path-normalization.js';
import { findPostcssConfigWithoutCsszyx, missingPostcssPluginMessage } from './safelist-source.js';
import { resolveTransformCacheDir } from './transform-cache.js';

/** Serializable options accepted by the Next Turbopack csszyx prebuild core. */
export interface NextPrebuildOptions extends NextLaneOptions {
    files: readonly string[];
    /** Receives the one-line notices a prebuild has for the maintainer; `console.warn` by default. */
    warn?: (message: string) => void;
    explicitRoot?: string;
    loaderRootContext?: string;
    loaderContext?: string;
    cwd?: string;
    /**
     * Whether a plain exported sz object may be compiled into its importers.
     *
     * Must match what the Turbopack loader is given: this pass writes the
     * safelist the loader's emitted classes rely on.
     */
    importedStaticSz?: boolean;
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

/** What a prebuild pass wrote before it materializes: one shard per file. */
export interface NextPrebuildShards {
    context: NextStateContext;
    scannedCount: number;
    transformedCount: number;
    skippedMissingCount: number;
    files: NextPrebuildFileResult[];
}

/** Aggregated result returned by `runNextPrebuild`. */
export interface NextPrebuildResult extends NextPrebuildShards {
    classCount: number;
    sourceCount: number;
    manifestPath: string;
    safelistOutputPath: string;
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
    const shards = writeNextPrebuildShards(options);
    const { context } = shards;
    const cycle = runNextWatcherCycle(context, {
        writeOptions: options.writeOptions,
        lockOptions: {
            root: context.root,
            mode: context.manifestExpectation.mode,
            command: NEXT_PREBUILD_LOCK_COMMAND,
        },
        createdAt: options.createdAt,
    });

    return {
        ...shards,
        classCount: cycle.materialize.classCount,
        sourceCount: cycle.materialize.sourceCount,
        manifestPath: context.manifestPath,
        safelistOutputPath: context.safelist.outputPath,
        cycle,
    };
}

/**
 * Transform each file and write its safelist shard, without materializing.
 *
 * `next watch` materializes on its own, under the watcher's command, and steps
 * aside when the Turbopack loader holds the lock; {@link runNextPrebuild}
 * materializes after this under its own.
 *
 * @param options Prebuild input options.
 * @returns The state context, the counts and one result per file.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function writeNextPrebuildShards(options: NextPrebuildOptions): NextPrebuildShards {
    assertNextMangleBoundary(options, (options.mode ?? 'production') === 'production', 'prebuild');

    const csszyxVersion =
        options.csszyxVersion ?? readPackageVersion('../package.json', import.meta.url);
    const compilerVersion =
        options.compilerVersion ??
        readPackageVersion('../../compiler/package.json', import.meta.url);
    const nativeVersion = options.nativeVersion ?? compilerVersion;
    const nextVersion = options.nextVersion ?? 'unknown-next';

    const context = createNextStateContext({
        explicitRoot: options.explicitRoot,
        loaderRootContext: options.loaderRootContext,
        loaderContext: options.loaderContext,
        cwd: options.cwd,
        cacheDir: options.cacheDir,
        safelistOutputFile: options.safelistOutputFile,
        config: configWithImportedStaticSz(options.config ?? {}, options.importedStaticSz),
        env: options.env ?? process.env,
        envKeys: options.envKeys,
        nextVersion,
        csszyxVersion,
        nativeVersion,
        mode: options.mode ?? 'production',
    });

    // Turbopack runs no plugin `buildStart`, so the prebuild is where a runtime
    // from another release stops the build. The plugin's own manifest, not the
    // caller's `csszyxVersion` identity, is the release the runtime must match.
    assertRuntimeMatchesPlugin({
        root: context.root,
        pluginVersion: readPackageVersion('../package.json', import.meta.url),
    });

    // The safelist this run writes reaches Tailwind only through the PostCSS
    // plugin; a config that does not list it makes every sz class silent.
    const postcssConfig = findPostcssConfigWithoutCsszyx(context.root);
    if (postcssConfig !== null) {
        (options.warn ?? console.warn)(
            missingPostcssPluginMessage(projectRelative(context.root, postcssConfig)),
        );
    }

    const cacheRoot = resolveTransformCacheDir(
        context.root,
        path.relative(context.root, context.cacheDir),
    );
    const prefix = resolveNextClassPrefix({
        root: context.root,
        cacheDir: context.cacheDir,
        tailwindStylesheet: [options.tailwindStylesheet ?? []].flat(),
    });
    if (!prefix.ok) {
        throw diagnosticError('next-prefix-unread', {
            lane: 'prebuild',
            root: context.root,
            reason: prefix.reason,
        });
    }

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
        // Resolved the same way the loader resolves it, from the same module.
        // The prebuild is what puts these classes in the safelist; if the two
        // disagreed, the loader would emit a class name whose rule was never
        // generated — worse than neither of them compiling it.
        const crossModule = resolveNextCrossModule({
            filename,
            source,
            root: context.root,
            importedStaticSz: options.importedStaticSz,
        });
        const transform = transformNextSource({
            source,
            filename,
            parserMode: options.parserMode ?? 'rust',
            compilerOptions: nextCompilerOptions({
                base: options.compilerOptions,
                statics: crossModule.statics,
                classPrefix: prefix.prefix,
                root: context.root,
            }),
            cacheRoot,
            pluginVersion: csszyxVersion,
            compilerVersion,
            astBudget: options.astBudget,
        });

        const metadata = collectNextTransformMetadata(transform.result, source, filename);
        transformedCount++;

        const shardResult = writeNextSafelistShard(
            context.safelist.shardsDir,
            createNextSafelistShardFromMetadata(metadata, createShardCacheKey(context, metadata)),
            options.writeOptions,
        );

        files.push({
            filename,
            shardPath: shardResult.filePath,
            classCount: metadata.classes.length,
            cacheStatus: transform.cacheStatus,
            producer: transform.producer,
        });
    }

    return { context, scannedCount, transformedCount, skippedMissingCount, files };
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
        .update(normalizePathSeparators(path.relative(context.root, metadata.sourcePath)))
        .digest('hex');
}
