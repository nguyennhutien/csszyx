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
    | '__szColorVar'
    | '__szSpacingVar'
    | '__szUnitVar';

/** Runtime helper usage flags from a compiler transform result. */
export interface NextRuntimeImportUsage {
    usesRuntime?: boolean;
    usesMerge?: boolean;
    usesSzcn?: boolean;
    usesSzPart?: boolean;
    usesSzvPick?: boolean;
    usesColorVar?: boolean;
    usesSpacingVar?: boolean;
    usesUnitVar?: boolean;
}

/** Result of runtime helper import injection. */
export interface NextRuntimeImportInjectionResult {
    code: string;
    injected: NextRuntimeHelper[];
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
    const helpers = runtimeHelpersFromUsage(usage);
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
 * @param usage
 */
function runtimeHelpersFromUsage(usage: NextRuntimeImportUsage): NextRuntimeHelper[] {
    const helpers: NextRuntimeHelper[] = [];
    if (usage.usesRuntime) {
        helpers.push('_sz');
    }
    if (usage.usesMerge) {
        helpers.push('_szMerge');
    }
    if (usage.usesSzcn) {
        helpers.push('_szcn');
    }
    if (usage.usesSzPart) {
        helpers.push('_szPart');
    }
    if (usage.usesSzvPick) {
        helpers.push('__szvPick');
    }
    if (usage.usesColorVar) {
        helpers.push('__szColorVar');
    }
    if (usage.usesSpacingVar) {
        helpers.push('__szSpacingVar');
    }
    if (usage.usesUnitVar) {
        helpers.push('__szUnitVar');
    }
    return helpers;
}

/**
 *
 * @param code
 * @param importStmt
 */
function insertRuntimeImport(code: string, importStmt: string): string {
    return insertAfterUseDirective(code, importStmt);
}
