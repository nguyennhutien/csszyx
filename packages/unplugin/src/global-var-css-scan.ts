import postcss, { type Root } from 'postcss';

import { buildScopeId, isInsideThemeAtRule, nodeLocation } from './global-var-postcss.js';
import type {
    CssVarDefinition,
    CssVarReference,
    CssVarScanResult,
    ScanGlobalVarCssOptions,
} from './global-var-types.js';

const VAR_REFERENCE_RE = /var\(\s*(--[\w-]+)/g;

/**
 * Scans one CSS source for custom-property definitions and var() references.
 *
 * @param css CSS source text.
 * @param options Scan options.
 * @returns Definitions, references, registrations, and ownership metadata.
 */
export function scanGlobalVarCss(
    css: string,
    options: ScanGlobalVarCssOptions = {},
): CssVarScanResult {
    const filePath = options.filePath ?? '<inline>';
    const root = postcss.parse(css, { from: filePath });
    const registered = collectRegisteredProperties(root);
    const definitions: CssVarDefinition[] = [];
    const references: CssVarReference[] = [];

    root.walkDecls(decl => {
        const scopeId = buildScopeId(decl);
        const tailwindOwned = isInsideThemeAtRule(decl);
        if (decl.prop.startsWith('--')) {
            definitions.push({
                name: decl.prop,
                scopeId,
                tailwindOwned,
                registered: registered.has(decl.prop),
                ...nodeLocation(decl, filePath),
            });
        }
        for (const name of extractVarReferences(decl.value)) {
            references.push({
                name,
                scopeId,
                owner: decl.prop,
                tailwindOwned,
                ...nodeLocation(decl, filePath),
            });
        }
    });

    root.walkAtRules(atRule => {
        if (atRule.name === 'property') {
            return;
        }
        for (const name of extractVarReferences(atRule.params)) {
            references.push({
                name,
                scopeId: buildScopeId(atRule),
                owner: `@${atRule.name}`,
                tailwindOwned: isInsideThemeAtRule(atRule),
                ...nodeLocation(atRule, filePath),
            });
        }
    });

    return {
        filePath,
        definitions,
        references,
        registered: [...registered].sort(),
        thirdParty: isThirdPartyCssPath(filePath),
    };
}

/**
 * Collects custom properties registered through @property at-rules.
 *
 * @param root Parsed PostCSS root.
 * @returns Registered custom-property names.
 */
function collectRegisteredProperties(root: Root): Set<string> {
    const registered = new Set<string>();
    root.walkAtRules('property', atRule => {
        const name = atRule.params.trim();
        if (name.startsWith('--')) {
            registered.add(name);
        }
    });
    return registered;
}

/**
 * Extracts CSS var() custom-property references from one value string.
 *
 * @param value CSS declaration value or at-rule params.
 * @returns Sorted unique custom-property references.
 */
function extractVarReferences(value: string): string[] {
    const references = new Set<string>();
    for (const match of value.matchAll(VAR_REFERENCE_RE)) {
        references.add(match[1]);
    }
    return [...references].sort();
}

/**
 * Checks if a CSS path belongs to a third-party package.
 *
 * @param filePath CSS source file path.
 * @returns true when the path contains node_modules.
 */
function isThirdPartyCssPath(filePath: string): boolean {
    return filePath.split(/[\\/]/).includes('node_modules');
}
