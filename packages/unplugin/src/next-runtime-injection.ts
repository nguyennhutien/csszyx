/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */

import { insertAfterUseDirective } from './directive-prologue.js';
import { importsRuntimeHelper } from './runtime-import-scan.js';

/** Runtime helpers emitted by csszyx compiler transforms. */
export type NextRuntimeHelper =
    | '_sz'
    | '_szMerge'
    | '_szcn'
    | '_szPart'
    | '__szvPick'
    | '__szvPick1'
    | '__szColorVar'
    | '__szSpacingVar'
    | '__szUnitVar'
    | '__szBoolClass';

/** Runtime helper usage flags from a compiler transform result. */
export interface NextRuntimeImportUsage {
    usesRuntime?: boolean;
    usesMerge?: boolean;
    usesSzcn?: boolean;
    usesSzPart?: boolean;
    usesSzvPick?: boolean;
    usesSzvPick1?: boolean;
    szPartArgsProvable?: boolean;
    usesColorVar?: boolean;
    usesSpacingVar?: boolean;
    usesUnitVar?: boolean;
    usesBoolClass?: boolean;
}

/** Result of runtime helper import injection. */
export interface NextRuntimeImportInjectionResult {
    code: string;
    injected: NextRuntimeHelper[];
}

/** Runtime helpers grouped by their package entry while preserving global order. */
export interface RuntimeHelperGroups {
    readonly all: NextRuntimeHelper[];
    readonly barrel: NextRuntimeHelper[];
    readonly merge: NextRuntimeHelper[];
}

/**
 * Collect compiler runtime helpers and assign slim-safe merge helpers to the
 * compiler-free entry.
 *
 * @param usage Runtime helper usage flags.
 * @returns Stable helper order plus package-entry groups.
 */
export function runtimeHelperGroupsFromUsage(usage: NextRuntimeImportUsage): RuntimeHelperGroups {
    const slim =
        usage.usesSzPart === true &&
        usage.szPartArgsProvable === true &&
        usage.usesRuntime !== true &&
        usage.usesMerge !== true;
    const groups: RuntimeHelperGroups = { all: [], barrel: [], merge: [] };
    const append = (helper: NextRuntimeHelper, toMerge = false): void => {
        groups.all.push(helper);
        (toMerge ? groups.merge : groups.barrel).push(helper);
    };
    if (usage.usesRuntime) append('_sz');
    if (usage.usesMerge) append('_szMerge');
    if (usage.usesSzcn) append('_szcn', slim);
    if (usage.usesSzPart) append('_szPart', slim);
    if (usage.usesSzvPick) append('__szvPick');
    if (usage.usesSzvPick1) append('__szvPick1');
    if (usage.usesColorVar) append('__szColorVar');
    if (usage.usesSpacingVar) append('__szSpacingVar');
    if (usage.usesUnitVar) append('__szUnitVar');
    if (usage.usesBoolClass) append('__szBoolClass');
    return groups;
}

/**
 * Inject missing `@csszyx/runtime` helper imports while preserving directives.
 *
 * @param code Transformed source code.
 * @param usage Runtime helper usage flags.
 * @returns Code plus the helper names injected by this pass.
 */
export function injectNextRuntimeImports(
    code: string,
    usage: NextRuntimeImportUsage,
): NextRuntimeImportInjectionResult {
    // Same slim rule as the vite/webpack hook: provably string-only _szPart
    // arguments route the merge helpers through the compiler-free entry.
    const groups = runtimeHelperGroupsFromUsage(usage);
    const helpers = groups.all;
    if (helpers.length === 0) {
        return { code, injected: [] };
    }

    const hasRuntimeImport = code.includes('@csszyx/runtime');
    const missing = hasRuntimeImport
        ? helpers.filter(helper => !importsRuntimeHelper(code, helper))
        : helpers;
    if (missing.length === 0) {
        return { code, injected: [] };
    }

    if (groups.merge.length > 0) {
        const mergeHelpers = missing.filter(helper => groups.merge.includes(helper));
        const barrelHelpers = missing.filter(helper => groups.barrel.includes(helper));
        let next = insertRuntimeImport(
            code,
            `import { ${mergeHelpers.join(', ')} } from '@csszyx/runtime/merge';\n`,
        );
        if (barrelHelpers.length > 0) {
            next = insertRuntimeImport(
                next,
                `import { ${barrelHelpers.join(', ')} } from '@csszyx/runtime';\n`,
            );
        }
        return { code: next, injected: missing };
    }

    return {
        code: insertRuntimeImport(
            code,
            `import { ${missing.join(', ')} } from '@csszyx/runtime';\n`,
        ),
        injected: missing,
    };
}

/**
 *
 * @param code
 * @param importStmt
 */
function insertRuntimeImport(code: string, importStmt: string): string {
    return insertAfterUseDirective(code, importStmt);
}
