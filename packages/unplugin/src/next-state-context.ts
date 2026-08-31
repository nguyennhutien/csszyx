/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import * as path from 'node:path';
import {
    createNextCacheIdentity,
    type JsonLike,
    type NextCacheIdentity,
} from './next-cache-identity.js';
import {
    type NextGenerationManifest,
    type NextGenerationManifestExpectation,
    type NextGenerationMode,
    resolveNextGenerationManifestPath,
} from './next-generation-manifest.js';
import {
    type NextAppRootInput,
    type NextAppRootResolution,
    resolveNextAppCacheDir,
    resolveNextAppRoot,
} from './next-root-resolver.js';
import {
    type NextSafelistStatePaths,
    resolveNextSafelistStatePaths,
} from './next-safelist-state.js';
import { assertNoLegacySourceStylesheet } from './safelist-source.js';

/** Inputs needed to derive one Next Turbopack csszyx state context. */
export interface NextStateContextInput extends NextAppRootInput {
    cacheDir?: string;
    safelistOutputFile?: string;
    config: JsonLike;
    env?: Record<string, string | undefined>;
    envKeys?: readonly string[];
    nextVersion: string;
    csszyxVersion: string;
    nativeVersion: string;
    mode: NextGenerationMode;
}

/** Shared state context consumed by future watcher, prebuild, and loader code. */
export interface NextStateContext {
    root: string;
    rootSource: NextAppRootResolution['source'];
    cacheDir: string;
    safelist: NextSafelistStatePaths;
    manifestPath: string;
    identity: NextCacheIdentity;
    manifestExpectation: NextGenerationManifestExpectation;
}

/**
 * Resolve a shared Next csszyx state context.
 *
 * @param input Context identity and root candidates.
 * @returns Shared state context.
 */
export function createNextStateContext(input: NextStateContextInput): NextStateContext {
    const rootResolution = resolveNextAppRoot(input);
    // Every Next producer builds its context here, so this is where a
    // stylesheet still naming the pre-plain-text safelist stops the run —
    // the Next lanes have no CSS transform to do it in.
    assertNoLegacySourceStylesheet(rootResolution.root);
    const cacheDir = resolveNextAppCacheDir(rootResolution.root, input.cacheDir);
    const identity = createNextCacheIdentity({
        root: rootResolution.root,
        config: input.config,
        env: input.env,
        envKeys: input.envKeys,
        nextVersion: input.nextVersion,
        csszyxVersion: input.csszyxVersion,
        nativeVersion: input.nativeVersion,
        mode: input.mode,
    });

    const manifestExpectation: NextGenerationManifestExpectation = {
        root: rootResolution.root,
        configHash: identity.configHash,
        envHash: identity.envHash,
        nextVersion: input.nextVersion,
        csszyxVersion: input.csszyxVersion,
        nativeVersion: input.nativeVersion,
        mode: input.mode,
    };

    return {
        root: rootResolution.root,
        rootSource: rootResolution.source,
        cacheDir,
        safelist: resolveNextSafelistStatePaths(
            rootResolution.root,
            relativeCacheDir(rootResolution.root, cacheDir),
            input.safelistOutputFile,
        ),
        manifestPath: resolveNextGenerationManifestPath(
            rootResolution.root,
            relativeCacheDir(rootResolution.root, cacheDir),
        ),
        identity,
        manifestExpectation,
    };
}

/**
 * Create a completed manifest from a shared state context.
 *
 * @param context Shared state context.
 * @param sourceCount Number of scanned source files.
 * @param createdAt ISO timestamp.
 * @returns Completed generation manifest.
 */
export function createNextGenerationManifestFromContext(
    context: NextStateContext,
    sourceCount: number,
    createdAt: string = new Date().toISOString(),
): NextGenerationManifest {
    return {
        schema: 1,
        generation: context.identity.generation,
        root: context.root,
        configHash: context.identity.configHash,
        envHash: context.identity.envHash,
        nextVersion: context.manifestExpectation.nextVersion,
        csszyxVersion: context.manifestExpectation.csszyxVersion,
        nativeVersion: context.manifestExpectation.nativeVersion,
        mode: context.manifestExpectation.mode,
        sourceCount,
        completed: true,
        createdAt,
    };
}

/**
 *
 * @param root
 * @param cacheDir
 */
function relativeCacheDir(root: string, cacheDir: string): string {
    const relative = path.relative(root, cacheDir);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
        ? relative
        : cacheDir;
}
