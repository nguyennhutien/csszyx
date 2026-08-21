/**
 * Cross-module szv registry: collection and per-file resolution.
 *
 * The bundler builds this once during its prescan — a single extractor
 * implementation, so cross-module knowledge cannot differ per parser — and
 * resolves each transformed file's import specifiers against it: relative ones
 * against the importing file, aliased ones through the project's alias table
 * (see `specifier-aliases`). The result feeds `options.crossModuleStatics`
 * identically into both engine builds, which then run their local precompile
 * machinery on the imported factories.
 *
 * Pure functions over an explicit registry map, split out of the plugin
 * factory so the probing rules are unit-testable without a build.
 *
 * @module cross-module-registry
 */

import * as path from 'node:path';
import {
    type CrossModuleExportKind,
    type CrossModuleForward,
    type CrossModuleRegistryEntry,
    extractCrossModuleForwards,
    extractCrossModuleRegistryEntries,
} from '@csszyx/compiler';
import { normalizePathSeparators } from './path-normalization.js';
import { aliasedSpecifierBases, type SpecifierAlias } from './specifier-aliases.js';

/** One recorded export, kept with what it is so a consumer knows which it got. */
export interface CrossModuleRegistryValue {
    kind: CrossModuleExportKind;
    value: Record<string, unknown>;
}

/** Separator-normalized absolute path → exported values by name. */
export type SzvCrossModuleRegistry = Map<string, Record<string, CrossModuleRegistryValue>>;

/**
 * Separator-normalized absolute path → the names it re-exports from elsewhere.
 *
 * Kept beside the registry rather than inside it because the two answer
 * different questions. The registry says what a module HAS; this says where a
 * module SENDS you. A reader that found a link where it expected a value would
 * compile against nothing, so the type keeps them from ever being confused.
 */
export type CrossModuleForwardIndex = Map<string, readonly CrossModuleForward[]>;

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
    const byName = emptyNameIndex<CrossModuleRegistryValue>();
    for (const [name, recorded] of Object.entries(registry.get(key) ?? {})) {
        if (recorded.kind !== kind) byName[name] = recorded;
    }
    for (const entry of entries) {
        if (entry.kind === kind) byName[entry.exportName] = { kind, value: entry.value };
    }
    if (Object.keys(byName).length === 0) registry.delete(key);
    else registry.set(key, byName);
}

/**
 * An empty map keyed by names read out of source text.
 *
 * Null-prototype on purpose. Every key here is an export name or an import
 * specifier lifted from a file the build did not write, and two of those names
 * are not ordinary keys on an ordinary object: assigning `__proto__` on a plain
 * object REPLACES its prototype instead of adding a property, and reading it
 * yields `Object.prototype` rather than nothing — so a `??=` guard sees a value
 * that is already there and writes straight onto the shared prototype.
 *
 * A provider exporting `__proto__`, or an import specifier spelled that way, is
 * therefore enough to reach every object in the process. Without a prototype
 * there is no setter to trigger and no inherited value to mistake for an entry:
 * the name becomes an ordinary key that resolves for nobody, which is what it
 * should have been all along.
 *
 * @returns A fresh object with no prototype.
 */
export function emptyNameIndex<T>(): Record<string, T> {
    return Object.create(null) as Record<string, T>;
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
 * Record which names one module re-exports from other modules.
 *
 * Separate from the two value passes because a forward is not a value and does
 * not belong to either kind: it is recorded once per module and evicted whole,
 * so a barrel that stops re-exporting a name cannot keep answering for it.
 *
 * @param index - The forward index to update.
 * @param filePath - Absolute source path (any separator style).
 * @param content - Source text.
 */
export function recordCrossModuleForwards(
    index: CrossModuleForwardIndex,
    filePath: string,
    content: string,
): void {
    const key = normalizePathSeparators(filePath);
    const forwards = extractCrossModuleForwards(content, filePath);
    if (forwards.length === 0) index.delete(key);
    else index.set(key, forwards);
}

/**
 * How many modules a single name may be followed through.
 *
 * Capped rather than trusted. A generated barrel tree is finite but need not be
 * short, and the walk is paid per importing file — so the cost of a deep tree
 * lands on every build, not once. A chain longer than this keeps the runtime
 * path, which is the same answer every other unreadable shape gets.
 */
export const MAX_FORWARD_HOPS = 8;

/**
 * Join a module path and an export name into one visited-set key.
 *
 * Keyed by BOTH on purpose: two barrels forwarding different names through each
 * other is not a cycle, and refusing it would cost a resolution that terminates
 * perfectly well. Exported so the Turbopack lane, which walks the same links
 * from disk instead of from a registry, cannot key its walk differently.
 *
 * @param modulePath - Module the name is looked up in.
 * @param name - Export name as that module spells it.
 * @returns The visited-set key.
 */
export function forwardVisitKey(modulePath: string, name: string): string {
    // A NUL cannot appear in a path or an export name, so no pair of them
    // can produce the same key as a different pair.
    return `${modulePath}\u0000${name}`;
}

/**
 * Everything one module exports, its own values and the ones it forwards.
 *
 * A name the module DECLARES wins over a forward of the same name: the
 * declaration is the value this module actually has, and a module that both
 * declares and re-exports one name is malformed anyway.
 *
 * @param registry - The prescan-built registry.
 * @param forwards - The prescan-built forward index.
 * @param modulePath - Separator-normalized module path.
 * @param aliases - Project alias table.
 * @returns The module's exports, or undefined when it contributes none.
 */
function moduleExports(
    registry: SzvCrossModuleRegistry,
    forwards: CrossModuleForwardIndex,
    modulePath: string,
    aliases: readonly SpecifierAlias[],
): Record<string, CrossModuleRegistryValue> | undefined {
    const own = registry.get(modulePath);
    const links = forwards.get(modulePath);
    if (links === undefined) return own;
    const merged = emptyNameIndex<CrossModuleRegistryValue>();
    for (const [name, value] of Object.entries(own ?? {})) merged[name] = value;
    for (const link of links) {
        if (merged[link.exportName] !== undefined) continue;
        const value = followForward(registry, forwards, modulePath, link, aliases, {
            hops: MAX_FORWARD_HOPS,
            visited: new Set([forwardVisitKey(modulePath, link.exportName)]),
        });
        if (value !== undefined) merged[link.exportName] = value;
    }
    return Object.keys(merged).length === 0 ? undefined : merged;
}

/** How much budget a forward walk has left, and where it has already been. */
interface ForwardWalk {
    hops: number;
    visited: Set<string>;
}

/**
 * Follow one re-export to the value it names.
 *
 * The specifier resolves against the FORWARDING module's directory, through the
 * same probe list a direct import uses — a forward landing on a different file
 * than a direct import of the same specifier would make a module's value depend
 * on which route reached it.
 *
 * @param registry - The prescan-built registry.
 * @param forwards - The prescan-built forward index.
 * @param fromPath - The module that wrote this re-export.
 * @param forward - The re-export to follow.
 * @param aliases - Project alias table.
 * @param walk - Remaining hop budget and the names already visited.
 * @returns The value, or undefined when the chain answers nothing.
 */
function followForward(
    registry: SzvCrossModuleRegistry,
    forwards: CrossModuleForwardIndex,
    fromPath: string,
    forward: CrossModuleForward,
    aliases: readonly SpecifierAlias[],
    walk: ForwardWalk,
): CrossModuleRegistryValue | undefined {
    if (walk.hops <= 0) return undefined;
    const directory = path.dirname(fromPath);
    for (const base of specifierBases(forward.specifier, directory, aliases)) {
        const providerPath = probeSpecifier(base, candidate =>
            registry.has(candidate) || forwards.has(candidate) ? candidate : undefined,
        );
        if (providerPath === undefined) continue;
        return lookupForwardedExport(
            registry,
            forwards,
            providerPath,
            forward.importedName,
            aliases,
            walk,
        );
    }
    return undefined;
}

/**
 * Find one export in a module, following it further when it is itself a link.
 *
 * The visited set is keyed by module AND name, not module alone: two barrels
 * forwarding different names through each other is not a cycle, and refusing it
 * would cost a resolution that terminates perfectly well.
 *
 * @param registry - The prescan-built registry.
 * @param forwards - The prescan-built forward index.
 * @param modulePath - Module to look in.
 * @param name - Export name as that module spells it.
 * @param aliases - Project alias table.
 * @param walk - Remaining hop budget and the names already visited.
 * @returns The value, or undefined when nothing answers.
 */
function lookupForwardedExport(
    registry: SzvCrossModuleRegistry,
    forwards: CrossModuleForwardIndex,
    modulePath: string,
    name: string,
    aliases: readonly SpecifierAlias[],
    walk: ForwardWalk,
): CrossModuleRegistryValue | undefined {
    const key = forwardVisitKey(modulePath, name);
    if (walk.visited.has(key)) return undefined;
    walk.visited.add(key);
    const own = registry.get(modulePath)?.[name];
    if (own !== undefined) return own;
    for (const link of forwards.get(modulePath) ?? []) {
        if (link.exportName !== name) continue;
        return followForward(registry, forwards, modulePath, link, aliases, {
            hops: walk.hops - 1,
            visited: walk.visited,
        });
    }
    return undefined;
}

/**
 * Resolve the registry entries visible to one file's imports.
 *
 * Each specifier is turned into the path(s) it may denote — its own directory
 * for a relative one, the alias table for anything else — and probed with the
 * usual extension set against registry keys. No filesystem access: the prescan
 * already walked it. A specifier written with its emitted extension resolves
 * to the source that produces it. A bare package specifier matches no alias
 * and resolves to nothing, which is what keeps `react` from being probed.
 *
 * @param registry - The prescan-built registry.
 * @param filename - Importing file path.
 * @param source - Importing file text.
 * @param aliases - Project alias table; empty leaves relative imports only.
 * @param forwards - Re-export links, so a barrel resolves to what it forwards.
 * @returns Specifier-keyed entries, or undefined when nothing resolves.
 */
export function resolveCrossModuleStaticsFor(
    registry: SzvCrossModuleRegistry,
    filename: string,
    source: string,
    aliases: readonly SpecifierAlias[] = [],
    forwards: CrossModuleForwardIndex = new Map(),
): ResolvedCrossModuleEntries {
    // An empty registry ends it whatever the forwards say: a chain of links
    // with no declared value at the end of it resolves to nothing anyway.
    if (registry.size === 0 || !source.includes('from')) return {};
    const directory = path.dirname(filename);
    const resolved: ResolvedCrossModuleEntries = {};
    const seen = new Set<string>();
    for (const specifier of importedSpecifiersIn(source)) {
        if (seen.has(specifier)) continue;
        seen.add(specifier);
        const entries = firstRegistryHit(registry, specifier, directory, aliases, forwards);
        if (entries !== undefined) fileUnderSpecifier(resolved, specifier, entries);
    }
    return resolved;
}

/**
 * The first registry entry any of a specifier's candidate paths answers with.
 *
 * Stops at the first hit: the probe order is the resolution order, so a later
 * candidate matching too would mean the specifier denotes two modules.
 *
 * @param registry - The prescan-built registry.
 * @param specifier - Specifier as written in the import.
 * @param directory - Importing file's directory.
 * @param aliases - Project alias table.
 * @param forwards - Re-export links, so a barrel counts as a match.
 * @returns The module's exports, or undefined when nothing matches.
 */
function firstRegistryHit(
    registry: SzvCrossModuleRegistry,
    specifier: string,
    directory: string,
    aliases: readonly SpecifierAlias[],
    forwards: CrossModuleForwardIndex,
): Record<string, CrossModuleRegistryValue> | undefined {
    for (const base of specifierBases(specifier, directory, aliases)) {
        // A barrel holds no value of its own, so it has to be recognised by its
        // links as well — probing the registry alone would walk past it and
        // resolve the specifier against a file the importer never named.
        const modulePath = probeSpecifier(base, candidate =>
            registry.has(candidate) || forwards.has(candidate) ? candidate : undefined,
        );
        if (modulePath === undefined) continue;
        return moduleExports(registry, forwards, modulePath, aliases);
    }
    return undefined;
}

/**
 * File one export under the specifier that named it, in the channel for its kind.
 *
 * The single place a name lifted from somebody else's source becomes a key.
 * Both lanes write through it — the prescan registry and the Turbopack
 * loader — because the hazard is in the keying, not in either lane, and a
 * second copy of these four lines is a second place to forget the guard.
 *
 * Two defences, because they fail differently. The tables carry no prototype,
 * so there is no setter to trigger even for a name nobody thought to reject;
 * and `__proto__` is rejected outright, so the guarantee does not rest on
 * every future caller remembering how these objects were built. A provider
 * exporting that name loses the precompile and compiles at runtime like any
 * module csszyx cannot read statically.
 *
 * Only that one name. The siblings usually listed beside it — `constructor`,
 * `prototype` — are ordinary properties under a single-level write: assigning
 * them shadows, it does not escape. Refusing those too would drop real exports
 * for nothing.
 *
 * @param resolved - Resolution being built.
 * @param kind - What the provider exported.
 * @param specifier - Specifier as written in the import.
 * @param name - Export name as the provider spelled it.
 * @param value - The exported value.
 */
export function recordResolvedEntry(
    resolved: ResolvedCrossModuleEntries,
    kind: CrossModuleExportKind,
    specifier: string,
    name: string,
    value: Record<string, unknown>,
): void {
    if (specifier === '__proto__' || name === '__proto__') return;
    const channel = kind === 'szv-config' ? 'szvConfigs' : 'szObjects';
    let bySpecifier = resolved[channel];
    if (bySpecifier === undefined) {
        bySpecifier = emptyNameIndex();
        resolved[channel] = bySpecifier;
    }
    let byName = bySpecifier[specifier];
    if (byName === undefined) {
        byName = emptyNameIndex();
        bySpecifier[specifier] = byName;
    }
    byName[name] = value;
}

/**
 * File one module's exports under the specifier that named it, split by kind.
 *
 * @param resolved - Resolution being built.
 * @param specifier - Specifier as written in the import.
 * @param entries - The module's recorded exports.
 */
function fileUnderSpecifier(
    resolved: ResolvedCrossModuleEntries,
    specifier: string,
    entries: Record<string, CrossModuleRegistryValue>,
): void {
    for (const [name, recorded] of Object.entries(entries)) {
        recordResolvedEntry(resolved, recorded.kind, specifier, name, recorded.value);
    }
}

/**
 * Every specifier a module imports from, in source order.
 *
 * Text rather than AST on purpose: this runs for every transformed file, and
 * the answer only has to be a superset of the real imports — a specifier that
 * matches no registry key resolves to nothing.
 *
 * @param source - Module source text.
 * @returns The specifiers, duplicates included.
 */
export function importedSpecifiersIn(source: string): string[] {
    if (!source.includes('from')) return [];
    return [...source.matchAll(/from\s*['"]([^'"]*)['"]/g)].map(match => match[1]);
}

/**
 * The absolute path(s) one specifier may denote, in probe order.
 *
 * The single place a specifier becomes a path. The prescan uses it to decide
 * which modules are worth reading and the transform uses it to look them up,
 * and the two MUST agree — a demand recorded under one path and looked up
 * under another silently costs the optimization it just paid to collect.
 *
 * @param specifier - Specifier as written in the import.
 * @param directory - Importing file's directory.
 * @param aliases - Project alias table.
 * @returns Candidate paths, empty when the specifier denotes none.
 */
export function specifierBases(
    specifier: string,
    directory: string,
    aliases: readonly SpecifierAlias[],
): string[] {
    if (specifier.startsWith('.')) {
        return [normalizePathSeparators(path.resolve(directory, specifier))];
    }
    return aliasedSpecifierBases(specifier, aliases);
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
    return resolveProviderPathWith(base, candidate => seenPaths.has(candidate));
}

/**
 * Resolve one specifier base against an arbitrary existence test.
 *
 * The prescan lanes answer from the paths their walk saw; the Turbopack loader
 * has no walk and answers from the filesystem. Both must land on the SAME file
 * for the same specifier, so the probe order lives here once and each caller
 * supplies only what "exists" means to it.
 *
 * @param base - Specifier resolved against the importing file's directory.
 * @param exists - Whether one candidate path is a readable provider.
 * @returns The provider path, or undefined when nothing matches.
 */
export function resolveProviderPathWith(
    base: string,
    exists: (candidate: string) => boolean,
): string | undefined {
    return probeSpecifier(base, candidate => (exists(candidate) ? candidate : undefined));
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
