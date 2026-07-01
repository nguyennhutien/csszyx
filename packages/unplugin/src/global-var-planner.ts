import { sortStrings } from '@csszyx/compiler';
import { encode } from '@csszyx/core';
import {
    CSSZYX_GLOBAL_ALIAS_PREFIX,
    isCsszyxGlobalAliasCustomProperty,
    isTailwindReservedCustomProperty,
} from '@csszyx/types';

import type {
    CssVarDefinition,
    CssVarScanResult,
    GlobalVarAliasDiagnostic,
    GlobalVarAliasEntry,
    GlobalVarAliasPlan,
    PlanGlobalVarAliasesInput,
} from './global-var-types.js';

/**
 * Plans deterministic global aliases for explicit app-owned tokens.
 *
 * @param input Planner input.
 * @returns Alias plan or fail-closed diagnostics.
 */
export function planGlobalVarAliases(input: PlanGlobalVarAliasesInput): GlobalVarAliasPlan {
    const definitions = flattenDefinitions(input.scans);
    const candidates = collectCandidates(input, definitions);
    const aliasPrefix = input.aliasPrefix ?? CSSZYX_GLOBAL_ALIAS_PREFIX;
    const diagnostics = validateCandidates(
        candidates,
        definitions,
        input.reserved ?? [],
        aliasPrefix,
    );
    if (diagnostics.length > 0) {
        return { entries: [], aliases: new Map(), diagnostics };
    }

    const definitionNames = new Set(definitions.keys());
    const entries: GlobalVarAliasEntry[] = [];
    for (const [index, original] of candidates.entries()) {
        const alias = `${aliasPrefix}${encode(index)}`;
        if (definitionNames.has(alias)) {
            return {
                entries: [],
                aliases: new Map(),
                diagnostics: [
                    {
                        code: 'alias-collision',
                        severity: 'error',
                        name: alias,
                        message: `Generated alias ${alias} collides with an existing CSS custom property.`,
                        location: definitions.get(alias)?.[0],
                    },
                ],
            };
        }
        entries.push({
            original,
            alias,
            scopes: sortStrings(
                new Set((definitions.get(original) ?? []).map(definition => definition.scopeId)),
            ),
        });
    }

    return {
        entries,
        aliases: new Map(entries.map(entry => [entry.original, entry.alias])),
        diagnostics: [],
    };
}

/**
 * Checks if a custom-property name is reserved by Tailwind v4.
 *
 * @param name Custom-property name.
 * @returns true when the name is Tailwind-owned by namespace.
 */
export function isTailwindReservedGlobalVar(name: string): boolean {
    return isTailwindReservedCustomProperty(name);
}

/**
 * Groups definitions by custom-property name.
 *
 * @param scans CSS scan results.
 * @returns Definitions grouped by name.
 */
function flattenDefinitions(scans: CssVarScanResult[]): Map<string, CssVarDefinition[]> {
    const definitions = new Map<string, CssVarDefinition[]>();
    for (const scan of scans) {
        for (const definition of scan.definitions) {
            const existing = definitions.get(definition.name) ?? [];
            existing.push(definition);
            definitions.set(definition.name, existing);
        }
    }
    return definitions;
}

/**
 * Collects explicit and prefix-discovered planner candidates.
 *
 * @param input Planner input.
 * @param definitions Definitions grouped by name.
 * @returns Sorted candidate names.
 */
function collectCandidates(
    input: PlanGlobalVarAliasesInput,
    definitions: ReadonlyMap<string, CssVarDefinition[]>,
): string[] {
    const candidates = new Set(input.tokens ?? []);
    const autoPrefix = input.autoPrefix ?? '';
    if (autoPrefix !== '') {
        for (const name of definitions.keys()) {
            if (name.startsWith(autoPrefix)) {
                candidates.add(name);
            }
        }
    }
    return sortStrings(candidates);
}

/**
 * Validates alias candidates before any rewrite can happen.
 *
 * @param candidates Candidate custom-property names.
 * @param definitions Definitions grouped by name.
 * @param reserved User reserved names or prefixes.
 * @param aliasPrefix Active generated alias prefix.
 * @returns Fail-closed diagnostics.
 */
function validateCandidates(
    candidates: string[],
    definitions: ReadonlyMap<string, CssVarDefinition[]>,
    reserved: string[],
    aliasPrefix: string,
): GlobalVarAliasDiagnostic[] {
    const diagnostics: GlobalVarAliasDiagnostic[] = [];
    for (const name of candidates) {
        const tokenDefinitions = definitions.get(name) ?? [];
        if (tokenDefinitions.length === 0) {
            diagnostics.push({
                code: 'missing-definition',
                severity: 'error',
                name,
                message: `Global variable token ${name} is not defined in scanned CSS.`,
            });
            continue;
        }
        if (isTailwindReservedGlobalVar(name) || matchesUserReserved(name, reserved)) {
            diagnostics.push({
                code: 'tailwind-reserved',
                severity: 'error',
                name,
                message: `Global variable token ${name} is reserved and cannot be aliased.`,
                location: tokenDefinitions[0],
            });
        }
        if (isCsszyxGlobalAliasCustomProperty(name, aliasPrefix)) {
            diagnostics.push({
                code: 'tailwind-reserved',
                severity: 'error',
                name,
                message: `Global variable token ${name} uses csszyx reserved namespace ${aliasPrefix}* and cannot be aliased.`,
                location: tokenDefinitions[0],
            });
        }
        const tailwindDefinition = tokenDefinitions.find(definition => definition.tailwindOwned);
        if (tailwindDefinition) {
            diagnostics.push({
                code: 'tailwind-owned',
                severity: 'error',
                name,
                message: `Global variable token ${name} is declared inside @theme and cannot be aliased.`,
                location: tailwindDefinition,
            });
        }
        const registeredDefinition = tokenDefinitions.find(definition => definition.registered);
        if (registeredDefinition) {
            diagnostics.push({
                code: 'registered-property',
                severity: 'error',
                name,
                message: `Registered custom property ${name} is not aliasable in Phase H v1.`,
                location: registeredDefinition,
            });
        }
    }
    return diagnostics;
}

/**
 * Checks a custom-property name against user reserved names or prefixes.
 *
 * @param name Custom-property name.
 * @param reserved User reserved names or prefixes.
 * @returns true when the name is reserved.
 */
function matchesUserReserved(name: string, reserved: string[]): boolean {
    return reserved.some(pattern => {
        if (pattern.endsWith('*')) {
            return name.startsWith(pattern.slice(0, -1));
        }
        return name === pattern;
    });
}
