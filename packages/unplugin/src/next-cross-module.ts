/**
 * Cross-module resolution for the Next Turbopack lane.
 *
 * The other lanes build a registry during a whole-project prescan and hand
 * each file its slice. Turbopack hands a loader ONE file at a time and has no
 * such pass, so this resolves the other way round: from the importing file's
 * own text, straight to the provider on disk.
 *
 * That inversion is why the lane can have the feature at all. It also carries
 * an obligation the prescan lanes discharge elsewhere — every provider read
 * here must be declared to the watcher, or an edited style module leaves its
 * importers compiled against the value it used to have. Stale output is worse
 * than the fallback, so the provider list is returned rather than assumed, and
 * a caller that cannot register dependencies has no business using this.
 *
 * @module next-cross-module
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import {
    type CrossModuleForward,
    type CrossModuleRegistryEntry,
    extractCrossModuleForwards,
    extractCrossModuleRegistryEntries,
    type TransformSourceCodeOptions,
} from '@csszyx/compiler';
import { DEFAULT_IMPORTED_STATIC_SZ } from '@csszyx/types';

import {
    forwardVisitKey,
    importedSpecifiersIn,
    MAX_FORWARD_HOPS,
    type ResolvedCrossModuleEntries,
    recordResolvedEntry,
    resolveProviderPathWith,
    specifierBases,
} from './cross-module-registry.js';
import type { JsonLike } from './next-cache-identity.js';
import { normalizePathSeparators } from './path-normalization.js';
import { isReadableProviderFile } from './provider-file.js';
import { collectSpecifierAliases, type SpecifierAlias } from './specifier-aliases.js';

/** What one file's imports resolved to, plus the files that answered. */
export interface NextCrossModuleResolution {
    /** Registry slice for the compiler, keyed by specifier as written. */
    statics: ResolvedCrossModuleEntries;
    /** Absolute provider paths that must be declared to the watcher. */
    providers: string[];
}

/** Inputs for one file's cross-module resolution. */
export interface NextCrossModuleInput {
    /** Importing file path. */
    filename: string;
    /** Importing file text. */
    source: string;
    /** Project root, for reading the alias table. */
    root: string;
    /** Whether plain exported sz objects may be compiled. */
    importedStaticSz?: boolean;
}

/**
 * Resolve the opt-in against the shared default.
 *
 * Every Next entry point takes it as an optional boolean, and each one has to
 * land on the same answer for an unset value: the loader emits the classes and
 * the prebuild safelists them, so two lanes disagreeing about the default
 * would ship class names with no rule behind them.
 *
 * @param value - The option as configured, if it was set at all.
 * @returns Whether imported static sz objects are compiled.
 */
export function resolveImportedStaticSz(value: boolean | undefined): boolean {
    return value ?? DEFAULT_IMPORTED_STATIC_SZ;
}

/**
 * Alias tables by project root.
 *
 * Reading `tsconfig.json` per transformed file would be one parse per module
 * for an answer that cannot differ between them. The loader runs many times in
 * one process, so the table is read once per root and kept.
 */
const aliasesByRoot = new Map<string, SpecifierAlias[]>();

/**
 * Forget every cached alias table.
 *
 * For tests, which build a project per case and would otherwise read the first
 * one's answer for all of them.
 */
export function clearNextAliasCache(): void {
    aliasesByRoot.clear();
}

/**
 * Resolve what one file's imports contribute, reading providers from disk.
 *
 * @param input - The importing file and its project.
 * @returns The registry slice and the providers it came from.
 */
export function resolveNextCrossModule(input: NextCrossModuleInput): NextCrossModuleResolution {
    const empty: NextCrossModuleResolution = { statics: {}, providers: [] };
    if (!input.source.includes('from')) return empty;

    let aliases = aliasesByRoot.get(input.root);
    if (aliases === undefined) {
        aliases = collectSpecifierAliases(input.root);
        aliasesByRoot.set(input.root, aliases);
    }

    const directory = path.dirname(input.filename);
    const statics: ResolvedCrossModuleEntries = {};
    const providers: string[] = [];
    const seen = new Set<string>();

    // One cache per resolution: a barrel and the file that imports it often name
    // the same provider, and re-reading it per specifier would parse the same
    // module several times for one file.
    const modules = new Map<string, ProviderModule>();
    for (const specifier of importedSpecifiersIn(input.source)) {
        if (seen.has(specifier)) continue;
        seen.add(specifier);
        for (const base of specifierBases(specifier, directory, aliases)) {
            const provider = resolveProviderPathWith(base, isReadableProviderFile);
            if (provider === undefined) continue;
            // Declared even when it exports nothing csszyx can use: the answer
            // "this module contributes nothing" is only valid while the file
            // says so, and an edit that ADDS an export has to invalidate this
            // importer too.
            providers.push(provider);
            const walk: ForwardContext = { aliases, modules, providers };
            recordEntries(statics, specifier, providerExports(provider, walk), input);
            break;
        }
    }
    return { statics, providers };
}

/** One provider module as this lane reads it: what it has, and where it points. */
interface ProviderModule {
    entries: readonly CrossModuleRegistryEntry[];
    forwards: readonly CrossModuleForward[];
}

/** What a forward walk shares across every hop of one file's resolution. */
interface ForwardContext {
    aliases: readonly SpecifierAlias[];
    modules: Map<string, ProviderModule>;
    /** Appended in place: every module followed THROUGH must be watched too. */
    providers: string[];
}

/**
 * Everything one provider exports, its own values and the ones it forwards.
 *
 * A barrel declares nothing, so without following its links it looks exactly
 * like a module with nothing to offer — and a barrel is the module a consumer
 * of a design system actually imports from.
 *
 * @param provider - Absolute provider path.
 * @param context - Alias table, module cache, and the watch list to extend.
 * @returns The entries, each under the name THIS module exports it as.
 */
function providerExports(
    provider: string,
    context: ForwardContext,
): readonly CrossModuleRegistryEntry[] {
    const module = readProviderModule(provider, context.modules);
    if (module.forwards.length === 0) return module.entries;
    const declared = new Set(module.entries.map(entry => entry.exportName));
    const resolved = [...module.entries];
    for (const forward of module.forwards) {
        // A name the module declares itself wins; the link is then a duplicate.
        if (declared.has(forward.exportName)) continue;
        const found = followForward(provider, forward, context, {
            hops: MAX_FORWARD_HOPS,
            visited: new Set([forwardVisitKey(provider, forward.exportName)]),
        });
        if (found !== undefined) resolved.push({ ...found, exportName: forward.exportName });
    }
    return resolved;
}

/** How much budget a forward walk has left, and where it has already been. */
interface ForwardWalk {
    hops: number;
    visited: Set<string>;
}

/**
 * Follow one re-export to the value it names, reading modules as it goes.
 *
 * Every module reached is pushed onto the watch list, including ones the
 * importing file never mentions. Editing the module at the far end of a barrel
 * chain changes what the importer compiles to, and an unwatched dependency is a
 * stale-output bug that only appears on the second build — strictly worse than
 * the fallback this feature replaces.
 *
 * @param fromPath - The module that wrote this re-export.
 * @param forward - The re-export to follow.
 * @param context - Alias table, module cache, and the watch list to extend.
 * @param walk - Remaining hop budget and the names already visited.
 * @returns The entry found, or undefined when the chain answers nothing.
 */
function followForward(
    fromPath: string,
    forward: CrossModuleForward,
    context: ForwardContext,
    walk: ForwardWalk,
): CrossModuleRegistryEntry | undefined {
    if (walk.hops <= 0) return undefined;
    for (const base of specifierBases(forward.specifier, path.dirname(fromPath), context.aliases)) {
        const next = resolveProviderPathWith(base, isReadableProviderFile);
        if (next === undefined) continue;
        const key = forwardVisitKey(next, forward.importedName);
        if (walk.visited.has(key)) return undefined;
        walk.visited.add(key);
        context.providers.push(next);
        const module = readProviderModule(next, context.modules);
        const own = module.entries.find(entry => entry.exportName === forward.importedName);
        if (own !== undefined) return own;
        const link = module.forwards.find(item => item.exportName === forward.importedName);
        if (link === undefined) return undefined;
        return followForward(next, link, context, { hops: walk.hops - 1, visited: walk.visited });
    }
    return undefined;
}

/**
 * Read one provider's exports and links, once per resolution.
 *
 * @param provider - Absolute provider path.
 * @param cache - Modules already read during this resolution.
 * @returns What the module has and where it points.
 */
function readProviderModule(provider: string, cache: Map<string, ProviderModule>): ProviderModule {
    const hit = cache.get(provider);
    if (hit !== undefined) return hit;
    let module: ProviderModule = { entries: [], forwards: [] };
    try {
        const text = readFileSync(provider, 'utf8');
        module = {
            entries: extractCrossModuleRegistryEntries(text, provider),
            forwards: extractCrossModuleForwards(text, provider),
        };
    } catch {
        // A provider that cannot be read costs the optimization for its
        // importers. Letting it throw would fail the build of a file whose own
        // source is fine, which is a worse trade for a build-time nicety.
    }
    cache.set(provider, module);
    return module;
}

/**
 * File one provider's entries under the specifier that named it.
 *
 * @param statics - Resolution being built.
 * @param specifier - Specifier as written in the import.
 * @param entries - Everything the provider exports.
 * @param input - The resolution's inputs, for the opt-in gate.
 */
function recordEntries(
    statics: ResolvedCrossModuleEntries,
    specifier: string,
    entries: readonly CrossModuleRegistryEntry[],
    input: NextCrossModuleInput,
): void {
    for (const entry of entries) {
        if (entry.kind === 'sz-object' && !resolveImportedStaticSz(input.importedStaticSz)) {
            continue;
        }
        recordResolvedEntry(statics, entry.kind, specifier, entry.exportName, entry.value);
    }
}

/**
 * Merge one file's resolution into the compiler options it will run with.
 *
 * Returns the original options untouched when nothing resolved, so a project
 * that shares no style modules keeps byte-identical cache keys.
 *
 * @param options - Compiler options as configured.
 * @param statics - Resolution for this file.
 * @returns Options carrying the registry slice, if there is one.
 */
export function withCrossModuleStatics(
    options: TransformSourceCodeOptions | undefined,
    statics: ResolvedCrossModuleEntries,
): TransformSourceCodeOptions | undefined {
    if (statics.szvConfigs === undefined && statics.szObjects === undefined) return options;
    return {
        ...options,
        ...(statics.szvConfigs === undefined ? {} : { crossModuleStatics: statics.szvConfigs }),
        ...(statics.szObjects === undefined ? {} : { crossModuleSzObjects: statics.szObjects }),
    };
}

/**
 * Fold the opt-in into the config that identifies a generation.
 *
 * The loader and the prebuild must agree on it: the loader emits the class and
 * the prebuild safelists it, so a lane running with the flag against one
 * without it ships class names with no rule behind them. The manifest hash
 * gate already catches config drift between the two — putting the flag in that
 * config is what makes THIS drift loud instead of silent.
 *
 * The RESOLVED value is folded in, never the raw option. Recording only the
 * `true` case would make "off" and "unset" hash alike, which was harmless
 * while unset meant off and became a silent trap once it stopped meaning that:
 * a loader turned off against a prebuild left on would agree on the hash and
 * disagree on the output.
 *
 * @param config - Config as given.
 * @param importedStaticSz - The opt-in, if set.
 * @returns Config carrying the resolved opt-in.
 */
export function configWithImportedStaticSz(
    config: JsonLike,
    importedStaticSz: boolean | undefined,
): JsonLike {
    return {
        ...(config as Record<string, unknown>),
        importedStaticSz: resolveImportedStaticSz(importedStaticSz),
    } as JsonLike;
}

/**
 * Normalize provider paths for a watcher declaration.
 *
 * @param providers - Absolute provider paths.
 * @returns The same paths, deduplicated and separator-normalized.
 */
export function normalizeProviderPaths(providers: readonly string[]): string[] {
    return [...new Set(providers.map(normalizePathSeparators))];
}
