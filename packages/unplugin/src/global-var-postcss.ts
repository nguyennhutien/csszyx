import type { AtRule, ChildNode, Declaration, Root } from 'postcss';

import type { CssVarLocation } from './global-var-types.js';

/** Default scope id when a node has no ancestor rule or at-rule. */
export const DEFAULT_SCOPE_ID = '<root>';

/**
 * Checks whether a node is nested inside Tailwind's @theme at-rule.
 *
 * @param node PostCSS child node.
 * @returns true when an ancestor at-rule is @theme.
 */
export function isInsideThemeAtRule(node: ChildNode): boolean {
    let current = node.parent as ChildNode | Root | undefined;
    while (current && current.type !== 'root') {
        if (current.type === 'atrule' && (current as AtRule).name === 'theme') {
            return true;
        }
        current = current.parent as ChildNode | Root | undefined;
    }
    return false;
}

/**
 * Checks whether a declaration block already contains a given property.
 *
 * @param decl Declaration whose siblings should be checked.
 * @param prop Custom-property name to find.
 * @returns true when the same parent already declares `prop`.
 */
export function hasSiblingDeclaration(decl: Declaration, prop: string): boolean {
    const parent = decl.parent;
    if (!parent || !('nodes' in parent)) {
        return false;
    }
    return parent.nodes.some(node => node.type === 'decl' && node.prop === prop);
}

/**
 * Reads a PostCSS node source location.
 *
 * @param node PostCSS node.
 * @param filePath Source file path for diagnostics.
 * @returns Source location with fallback line and column.
 */
export function nodeLocation(node: ChildNode, filePath: string): CssVarLocation {
    return {
        filePath,
        line: node.source?.start?.line ?? 1,
        column: node.source?.start?.column ?? 1,
    };
}

/**
 * Builds a stable scope key from ancestor at-rules and selectors.
 *
 * @param node PostCSS child node.
 * @returns Stable scope identifier.
 */
export function buildScopeId(node: ChildNode): string {
    const parts: string[] = [];
    let current = node.parent as ChildNode | Root | undefined;
    while (current && current.type !== 'root') {
        if (current.type === 'rule') {
            parts.push(`rule:${current.selector}`);
        } else if (current.type === 'atrule') {
            const atRule = current as AtRule;
            parts.push(`@${atRule.name} ${atRule.params}`.trim());
        }
        current = current.parent as ChildNode | Root | undefined;
    }
    return parts.reverse().join(' > ') || DEFAULT_SCOPE_ID;
}
