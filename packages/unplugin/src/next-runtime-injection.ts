/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import { importsRuntimeHelper } from './runtime-import-scan.js';

const DIRECTIVE_PROLOGUE_PREFIX_RE =
    /^((?:\s|\/\/[^\n]*\n|\/\*(?:[^*]|\*(?!\/))*\*\/)*)(['"]use (?:client|server)['"];?\s*)/;

/** Runtime helpers emitted by csszyx compiler transforms. */
export type NextRuntimeHelper = '_sz' | '_szMerge' | '_szcn' | '_szPart' | '__szColorVar';

/** Runtime helper usage flags from a compiler transform result. */
export interface NextRuntimeImportUsage {
    usesRuntime?: boolean;
    usesMerge?: boolean;
    usesSzcn?: boolean;
    usesSzPart?: boolean;
    usesColorVar?: boolean;
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
    if (usage.usesColorVar) {
        helpers.push('__szColorVar');
    }
    return helpers;
}

/**
 *
 * @param code
 * @param importStmt
 */
function insertRuntimeImport(code: string, importStmt: string): string {
    const directiveMatch = code.match(DIRECTIVE_PROLOGUE_PREFIX_RE);
    if (!directiveMatch) {
        return `${importStmt}${code}`;
    }
    return code.replace(directiveMatch[0], `${directiveMatch[1]}${directiveMatch[2]}${importStmt}`);
}
