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
    type CrossModuleRegistryEntry,
    extractCrossModuleRegistryEntries,
    type TransformSourceCodeOptions,
} from '@csszyx/compiler';
import { DEFAULT_BUILD_CONFIG } from '@csszyx/types';

import {
    importedSpecifiersIn,
    type ResolvedCrossModuleEntries,
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
    return value ?? DEFAULT_BUILD_CONFIG.importedStaticSz ?? false;
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
            recordEntries(statics, specifier, readProviderEntries(provider), input);
            break;
        }
    }
    return { statics, providers };
}

/**
 * Read one provider's exported entries, treating any failure as "none".
 *
 * A provider that cannot be read or parsed costs the optimization for its
 * importers. Letting it throw would instead fail the build of a file whose own
 * source is fine, which is a worse trade for a build-time nicety.
 *
 * @param provider - Absolute provider path.
 * @returns The entries it exports, empty when it exports none.
 */
function readProviderEntries(provider: string): readonly CrossModuleRegistryEntry[] {
    try {
        return extractCrossModuleRegistryEntries(readFileSync(provider, 'utf8'), provider);
    } catch {
        return [];
    }
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
        const channel = entry.kind === 'szv-config' ? 'szvConfigs' : 'szObjects';
        statics[channel] ??= {};
        const bySpecifier = statics[channel];
        bySpecifier[specifier] ??= {};
        bySpecifier[specifier][entry.exportName] = entry.value;
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
