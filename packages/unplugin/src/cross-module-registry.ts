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
 * @module cross-module-registry
 */

import * as path from 'node:path';
import {
    type CrossModuleExportKind,
    type CrossModuleRegistryEntry,
    extractCrossModuleRegistryEntries,
} from '@csszyx/compiler';
import { normalizePathSeparators } from './path-normalization.js';

/** One recorded export, kept with what it is so a consumer knows which it got. */
export interface CrossModuleRegistryValue {
    kind: CrossModuleExportKind;
    value: Record<string, unknown>;
}

/** Separator-normalized absolute path → exported values by name. */
export type SzvCrossModuleRegistry = Map<string, Record<string, CrossModuleRegistryValue>>;

/** One file's specifier-keyed view of the registry, one entry per export name. */
type ResolvedBySpecifier = Record<string, Record<string, Record<string, unknown>>>;

/**
 * What one file's relative imports resolve to, split by kind.
 *
 * The registry keeps the two together because they come from one walk of one
 * file. They separate at the boundary because the engines do different things
 * with them: an szv config is a variant TABLE to compile and pick from, an sz
 * object is a VALUE to lower. Two named fields say which is which without any
 * reader — the native decoder included — having to infer it from the shape.
 */
export interface ResolvedCrossModuleEntries {
    szvConfigs?: ResolvedBySpecifier;
    szObjects?: ResolvedBySpecifier;
}

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
    const entries = mayExportSzvFactories(content)
        ? extractCrossModuleRegistryEntries(content, filePath)
        : [];
    replaceEntriesOfKind(registry, filePath, 'szv-config', entries);
}

/**
 * Record one file's exported static sz objects into the registry.
 *
 * Separate from the szv pass because it runs at a different time: which files
 * are worth reading for sz objects is only known once every sz-authoring file
 * has been seen, and asking every module in the project would parse code that
 * has nothing to do with styling.
 *
 * @param registry - The registry to fill.
 * @param filePath - Absolute source path (any separator style).
 * @param content - Source text.
 */
export function recordSzObjectRegistryFile(
    registry: SzvCrossModuleRegistry,
    filePath: string,
    content: string,
): void {
    replaceEntriesOfKind(
        registry,
        filePath,
        'sz-object',
        extractCrossModuleRegistryEntries(content, filePath),
    );
}

/**
 * Replace everything one file contributed of ONE kind, leaving the rest.
 *
 * The two kinds are recorded by separate passes, so neither may overwrite the
 * other's entries — and each must still be able to evict its own. A file that
 * stops exporting a factory has to lose it, or importers keep compiling
 * against a table the module no longer has.
 *
 * @param registry - The registry to update.
 * @param filePath - Absolute source path (any separator style).
 * @param kind - The kind this pass owns.
 * @param entries - Everything the extractor found, both kinds included.
 */
function replaceEntriesOfKind(
    registry: SzvCrossModuleRegistry,
    filePath: string,
    kind: CrossModuleExportKind,
    entries: readonly CrossModuleRegistryEntry[],
): void {
    const key = normalizePathSeparators(filePath);
    const byName: Record<string, CrossModuleRegistryValue> = {};
    for (const [name, recorded] of Object.entries(registry.get(key) ?? {})) {
        if (recorded.kind !== kind) byName[name] = recorded;
    }
    for (const entry of entries) {
        if (entry.kind === kind) byName[entry.exportName] = { kind, value: entry.value };
    }
    if (Object.keys(byName).length === 0) registry.delete(key);
    else registry.set(key, byName);
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
): ResolvedCrossModuleEntries {
    if (registry.size === 0 || !source.includes('from')) return {};
    const directory = path.dirname(filename);
    const resolved: ResolvedCrossModuleEntries = {};
    const seen = new Set<string>();
    for (const specifier of relativeSpecifiersIn(source)) {
        if (seen.has(specifier)) continue;
        seen.add(specifier);
        const base = normalizePathSeparators(path.resolve(directory, specifier));
        const entries = lookupRegistryKey(registry, base);
        if (entries === undefined) continue;
        for (const [name, recorded] of Object.entries(entries)) {
            const channel = recorded.kind === 'szv-config' ? 'szvConfigs' : 'szObjects';
            resolved[channel] ??= {};
            const bySpecifier = resolved[channel];
            bySpecifier[specifier] ??= {};
            bySpecifier[specifier][name] = recorded.value;
        }
    }
    return resolved;
}

/**
 * Every relative specifier a module imports from, in source order.
 *
 * Text rather than AST on purpose: this runs for every transformed file, and
 * the answer only has to be a superset of the real imports — a specifier that
 * matches no registry key resolves to nothing.
 *
 * @param source - Module source text.
 * @returns The relative specifiers, duplicates included.
 */
export function relativeSpecifiersIn(source: string): string[] {
    if (!source.includes('from')) return [];
    return [...source.matchAll(/from\s*['"](\.[^'"]*)['"]/g)].map(match => match[1]);
}

/**
 * Resolve one specifier base against a set of known source paths.
 *
 * The prescan's second pass has to turn `./styles` into the file on disk that
 * a consumer meant, and it must land on the SAME file the registry lookup
 * would — so both walk one probe list. Answering from the paths the walk
 * already saw keeps this free of filesystem guessing.
 *
 * @param seenPaths - Separator-normalized paths the prescan walked.
 * @param base - Specifier resolved against the importing file's directory.
 * @returns The provider path, or undefined when nothing matches.
 */
export function resolveProviderPath(
    seenPaths: ReadonlySet<string>,
    base: string,
): string | undefined {
    return probeSpecifier(base, candidate => (seenPaths.has(candidate) ? candidate : undefined));
}

/**
 * Walk the probe list for one specifier base until a lookup answers.
 *
 * @param base - Specifier resolved against the importing file's directory.
 * @param lookup - Called with each candidate path.
 * @returns The first non-undefined answer.
 */
function probeSpecifier<T>(
    base: string,
    lookup: (candidate: string) => T | undefined,
): T | undefined {
    for (const probe of SPECIFIER_PROBES) {
        const found = lookup(`${base}${probe}`);
        if (found !== undefined) return found;
    }
    for (const [emitted, sources] of EMITTED_EXTENSION_SOURCES) {
        if (!base.endsWith(emitted)) continue;
        const stem = base.slice(0, -emitted.length);
        for (const extension of sources) {
            const found = lookup(`${stem}${extension}`);
            if (found !== undefined) return found;
        }
        break;
    }
    return undefined;
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
): Record<string, CrossModuleRegistryValue> | undefined {
    return probeSpecifier(base, candidate => registry.get(candidate));
}
