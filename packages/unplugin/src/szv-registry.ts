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
import { extractCrossModuleRegistryEntries } from '@csszyx/compiler';
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
        ? extractCrossModuleRegistryEntries(content, filePath)
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
        // szv configs only for now: the extractor also reads plain exported sz
        // objects, but nothing resolves those yet, and a registry carrying
        // entries no consumer reads is weight in the cache key for nothing.
        if (entry.kind === 'szv-config') byName[entry.exportName] = entry.value;
    }
    registry.set(key, byName);
}

/** Extension probes tried against the registry, resolution order fixed. */
const SPECIFIER_PROBES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'] as const;

/**
 * Source extensions a specifier written with its EMITTED extension resolves to.
 *
 * Under TypeScript's `node16`/`nodenext` module resolution the import is
 * written as `./styles.js` and the file on disk is `styles.ts`. Probing the
 * literal specifier alone missed every such module, so a whole project style
 * silently lost the cross-module precompile with no way to tell from the
 * outside. Order matters only in that the first hit wins; two source files
 * differing solely in extension cannot both emit the same specifier.
 */
const EMITTED_EXTENSION_SOURCES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['.js', ['.ts', '.tsx']],
    ['.jsx', ['.tsx']],
    ['.mjs', ['.mts']],
    ['.cjs', ['.cts']],
];

/**
 * Resolve the registry entries visible to one file's relative imports.
 *
 * Relative specifiers only (v1): each is resolved against the importing
 * file's directory and probed with the usual extension set against registry
 * keys — no filesystem access, the prescan already walked it. A specifier
 * written with its emitted extension resolves to the source that produces it.
 * Non-relative specifiers (packages, tsconfig paths) are out of scope.
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
        const entries = lookupRegistryKey(registry, base);
        if (entries !== undefined) {
            resolved ??= {};
            resolved[specifier] = entries;
        }
    }
    return resolved;
}

/**
 * Find the registry entry for one resolved specifier path.
 *
 * @param registry - The prescan-built registry.
 * @param base - Specifier resolved against the importing file's directory.
 * @returns The module's factories, or undefined when nothing matches.
 */
function lookupRegistryKey(
    registry: SzvCrossModuleRegistry,
    base: string,
): Record<string, Record<string, unknown>> | undefined {
    for (const probe of SPECIFIER_PROBES) {
        const entries = registry.get(`${base}${probe}`);
        if (entries !== undefined) return entries;
    }
    for (const [emitted, sources] of EMITTED_EXTENSION_SOURCES) {
        if (!base.endsWith(emitted)) continue;
        const stem = base.slice(0, -emitted.length);
        for (const extension of sources) {
            const entries = registry.get(`${stem}${extension}`);
            if (entries !== undefined) return entries;
        }
        break;
    }
    return undefined;
}
