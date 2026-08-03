/**
 * Cross-module szv registry: collection and per-file resolution.
 *
 * The bundler builds this once during its prescan — a single extractor
 * implementation, so cross-module knowledge cannot differ per parser — and
 * resolves each transformed file's RELATIVE import specifiers against it. The
 * result feeds `options.crossModuleStatics` identically into all three
 * engines, which then run their local precompile machinery on the imported
 * factories.
 *
 * Pure functions over an explicit registry map, split out of the plugin
 * factory so the probing rules are unit-testable without a build.
 *
 * @module szv-registry
 */

import * as path from 'node:path';
import { extractSzvRegistryEntries } from '@csszyx/compiler';
import { normalizePathSeparators } from './path-normalization.js';

/** Separator-normalized absolute path → exported factory configs by name. */
export type SzvCrossModuleRegistry = Map<string, Record<string, Record<string, unknown>>>;

/**
 * Whether a file could contribute factories to the registry at all.
 *
 * The cheap marker gate that runs before any parse. Also asked of files the
 * prescan SKIPS, so a skip that costs importers their precompile can be
 * reported as such — the two questions must use one predicate or the report
 * drifts from the behaviour.
 *
 * @param content - Source text.
 * @returns True when the file may export an szv factory.
 */
export function mayExportSzvFactories(content: string): boolean {
    return content.includes('szv(') && content.includes('export');
}

/**
 * Record one file's exported szv factories into the registry.
 *
 * Cheap-gated by {@link mayExportSzvFactories} before parsing; a file with no
 * qualifying factory records nothing.
 *
 * @param registry - The registry to fill.
 * @param filePath - Absolute source path (any separator style).
 * @param content - Source text.
 */
export function recordSzvRegistryFile(
    registry: SzvCrossModuleRegistry,
    filePath: string,
    content: string,
): void {
    const key = normalizePathSeparators(filePath);
    const entries = mayExportSzvFactories(content)
        ? extractSzvRegistryEntries(content, filePath)
        : [];
    if (entries.length === 0) {
        // Re-recording a file that STOPPED qualifying must evict its entry, or
        // importers keep compiling against a table the module no longer
        // exports.
        registry.delete(key);
        return;
    }
    const byName: Record<string, Record<string, unknown>> = {};
    for (const entry of entries) {
        byName[entry.exportName] = entry.config;
    }
    registry.set(key, byName);
}

/** Extension probes tried against the registry, resolution order fixed. */
const SPECIFIER_PROBES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'] as const;

/**
 * Resolve the registry entries visible to one file's relative imports.
 *
 * Relative specifiers only (v1): each is resolved against the importing
 * file's directory and probed with the usual extension set against registry
 * keys — no filesystem access, the prescan already walked it. Non-relative
 * specifiers (packages, tsconfig paths) are out of scope and skipped.
 *
 * @param registry - The prescan-built registry.
 * @param filename - Importing file path.
 * @param source - Importing file text.
 * @returns Specifier-keyed entries, or undefined when nothing resolves.
 */
export function resolveCrossModuleStaticsFor(
    registry: SzvCrossModuleRegistry,
    filename: string,
    source: string,
): Record<string, Record<string, Record<string, unknown>>> | undefined {
    if (registry.size === 0 || !source.includes('from')) return undefined;
    const directory = path.dirname(filename);
    let resolved: Record<string, Record<string, Record<string, unknown>>> | undefined;
    for (const match of source.matchAll(/from\s*['"](\.[^'"]*)['"]/g)) {
        const specifier = match[1];
        if (resolved?.[specifier] !== undefined) continue;
        const base = normalizePathSeparators(path.resolve(directory, specifier));
        for (const probe of SPECIFIER_PROBES) {
            const entries = registry.get(`${base}${probe}`);
            if (entries !== undefined) {
                resolved ??= {};
                resolved[specifier] = entries;
                break;
            }
        }
    }
    return resolved;
}
