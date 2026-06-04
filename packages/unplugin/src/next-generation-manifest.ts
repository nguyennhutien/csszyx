/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { type AtomicWriteOptions, atomicWriteFileSync } from './next-safelist-state.js';

/** Mode represented by a Next Turbopack generation manifest. */
export type NextGenerationMode = 'development' | 'production';

/** Complete generation manifest written before Next consumes cached state. */
export interface NextGenerationManifest {
    schema: 1;
    generation: string;
    root: string;
    configHash: string;
    envHash: string;
    nextVersion: string;
    csszyxVersion: string;
    nativeVersion: string;
    mode: NextGenerationMode;
    sourceCount: number;
    completed: boolean;
    createdAt: string;
}

/** Inputs expected by a loader/watcher before trusting a manifest. */
export interface NextGenerationManifestExpectation {
    root: string;
    configHash: string;
    envHash: string;
    nextVersion: string;
    csszyxVersion: string;
    nativeVersion: string;
    mode: NextGenerationMode;
}

/** Manifest validation result with an actionable reason on mismatch. */
export interface NextGenerationManifestValidation {
    ok: boolean;
    reason?: string;
}

/**
 * Resolve the generation manifest path for a Next app cache directory.
 *
 * @param rootDir Project root.
 * @param cacheDir User configured cache dir. Defaults to `.csszyx/cache`.
 * @returns Absolute manifest path.
 */
export function resolveNextGenerationManifestPath(
    rootDir: string,
    cacheDir = '.csszyx/cache',
): string {
    return path.resolve(rootDir, cacheDir, 'generation-manifest.json');
}

/**
 * Write a completed generation manifest by atomic rename.
 *
 * @param manifestPath Destination manifest path.
 * @param manifest Manifest to write.
 * @param options Atomic write options.
 */
export function writeNextGenerationManifest(
    manifestPath: string,
    manifest: NextGenerationManifest,
    options: AtomicWriteOptions = {},
): void {
    atomicWriteFileSync(
        manifestPath,
        `${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`,
        options,
    );
}

/**
 * Read a generation manifest from disk.
 *
 * @param manifestPath Manifest file path.
 * @returns Parsed manifest, or null when missing/corrupt/incomplete schema.
 */
export function readNextGenerationManifest(manifestPath: string): NextGenerationManifest | null {
    try {
        return normalizeManifest(
            JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as NextGenerationManifest,
        );
    } catch {
        return null;
    }
}

/**
 * Validate whether a manifest matches the current loader/watcher context.
 *
 * @param manifest Manifest returned by `readNextGenerationManifest`.
 * @param expected Expected context identity.
 * @returns Validation result.
 */
export function validateNextGenerationManifest(
    manifest: NextGenerationManifest | null,
    expected: NextGenerationManifestExpectation,
): NextGenerationManifestValidation {
    if (!manifest) {
        return { ok: false, reason: 'missing or unreadable generation manifest' };
    }
    if (manifest.schema !== 1) {
        return { ok: false, reason: `unsupported generation manifest schema ${manifest.schema}` };
    }
    if (!manifest.completed) {
        return { ok: false, reason: 'generation manifest is incomplete' };
    }
    if (manifest.root !== path.resolve(expected.root)) {
        return { ok: false, reason: 'generation manifest root does not match this Next app' };
    }
    if (manifest.configHash !== expected.configHash) {
        return { ok: false, reason: 'csszyx config hash changed' };
    }
    if (manifest.envHash !== expected.envHash) {
        return { ok: false, reason: 'csszyx env hash changed' };
    }
    if (manifest.nextVersion !== expected.nextVersion) {
        return { ok: false, reason: 'Next.js version changed' };
    }
    if (manifest.csszyxVersion !== expected.csszyxVersion) {
        return { ok: false, reason: 'csszyx version changed' };
    }
    if (manifest.nativeVersion !== expected.nativeVersion) {
        return { ok: false, reason: 'csszyx native engine version changed' };
    }
    if (manifest.mode !== expected.mode) {
        return { ok: false, reason: 'generation manifest mode changed' };
    }
    return { ok: true };
}

/**
 *
 * @param manifest
 */
function normalizeManifest(manifest: NextGenerationManifest): NextGenerationManifest {
    if (
        manifest.schema !== 1 ||
        typeof manifest.generation !== 'string' ||
        typeof manifest.root !== 'string' ||
        typeof manifest.configHash !== 'string' ||
        typeof manifest.envHash !== 'string' ||
        typeof manifest.nextVersion !== 'string' ||
        typeof manifest.csszyxVersion !== 'string' ||
        typeof manifest.nativeVersion !== 'string' ||
        (manifest.mode !== 'development' && manifest.mode !== 'production') ||
        typeof manifest.sourceCount !== 'number' ||
        typeof manifest.completed !== 'boolean' ||
        typeof manifest.createdAt !== 'string'
    ) {
        throw new Error('Invalid csszyx Next generation manifest.');
    }

    return {
        ...manifest,
        root: path.resolve(manifest.root),
        sourceCount: Math.max(0, Math.trunc(manifest.sourceCount)),
    };
}
