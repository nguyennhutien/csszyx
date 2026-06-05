/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
const DIRECTIVE_PROLOGUE_PREFIX_RE =
    /^((?:\s|\/\/[^\n]*\n|\/\*(?:[^*]|\*(?!\/))*\*\/)*)(['"]use (?:client|server)['"];?\s*)/;

const RUNTIME_HELPER_IMPORT_RE: Record<NextRuntimeHelper, RegExp> = {
    _sz: /\{[^}]*\b_sz\b[^}]*\}\s*from\s*['"]@csszyx\/runtime['"]/,
    _szMerge: /\{[^}]*\b_szMerge\b[^}]*\}\s*from\s*['"]@csszyx\/runtime['"]/,
    __szColorVar: /\{[^}]*\b__szColorVar\b[^}]*\}\s*from\s*['"]@csszyx\/runtime['"]/,
};

/** Runtime helpers emitted by csszyx compiler transforms. */
export type NextRuntimeHelper = '_sz' | '_szMerge' | '__szColorVar';

/** Runtime helper usage flags from a compiler transform result. */
export interface NextRuntimeImportUsage {
    usesRuntime?: boolean;
    usesMerge?: boolean;
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
        ? helpers.filter(helper => !RUNTIME_HELPER_IMPORT_RE[helper].test(code))
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
