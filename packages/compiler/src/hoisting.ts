/**
 * CSS Variable Hoisting — deduplicates identical CSS variables across sibling elements.
 *
 * When multiple JSX elements in the same component share the same CSS variable
 * name and value, the variable is hoisted to the nearest common ancestor JSX element.
 *
 * Hoisting rule: ALWAYS safe within the same Babel transform scope.
 * Inner inline styles override inherited CSS variable values due to CSS cascade.
 *
 * @module @csszyx/compiler/hoisting
 */

import * as t from '@babel/types';

/**
 * Tracks a CSS variable usage on a specific JSX element.
 */
export interface CSSVarUsage {
    /** The JSX element AST node */
    element: t.JSXOpeningElement;
    /** CSS variable name, e.g., --_sz-p */
    varName: string;
    /** The style value AST expression */
    valueExpr: t.Expression;
    /** Serialized value for comparison (null if dynamic/non-comparable) */
    serializedValue: string | null;
}

/**
 * Finds the lowest common ancestor JSX opening element between two nodes.
 *
 * @param nodeA - First JSX opening element
 * @param nodeB - Second JSX opening element
 * @param parentMap - Map of child-to-parent relationships in the AST
 * @returns The lowest common JSX ancestor, or null if none exists (e.g., Fragment)
 */
function findLCA(
    nodeA: t.JSXOpeningElement,
    nodeB: t.JSXOpeningElement,
    parentMap: Map<t.Node, t.Node>,
): t.JSXOpeningElement | null {
    const ancestorsA = new Set<t.Node>();
    let current: t.Node | undefined = nodeA;
    while (current) {
        ancestorsA.add(current);
        current = parentMap.get(current);
    }

    current = nodeB;
    while (current) {
        if (ancestorsA.has(current)) {
            // A parsed AST's parent chain holds JSXElement wrappers — the
            // ancestor's JSXOpeningElement sits on a sibling branch, so accept
            // the wrapper and hoist onto its opening element. A direct
            // JSXOpeningElement in the chain (hand-built maps) still matches.
            let opening: t.JSXOpeningElement | null = null;
            if (t.isJSXOpeningElement(current)) opening = current;
            else if (t.isJSXElement(current)) opening = current.openingElement;
            if (opening && opening !== nodeA && opening !== nodeB) {
                return opening;
            }
        }
        current = parentMap.get(current);
    }
    return null;
}

/**
 * Checks if a JSX element is a Fragment (can't have style attributes).
 *
 * @param node - The JSX opening element to check
 * @returns True if the element is a React Fragment
 */
function isFragment(node: t.JSXOpeningElement): boolean {
    if (t.isJSXIdentifier(node.name)) {
        return node.name.name === 'Fragment';
    }
    if (t.isJSXMemberExpression(node.name)) {
        return t.isJSXIdentifier(node.name.property) && node.name.property.name === 'Fragment';
    }
    return false;
}

/**
 * Read an object-valued JSX style attribute.
 * @param attribute - Candidate JSX attribute or spread.
 * @returns The style object, or null for a different/unsupported attribute.
 */
function styleObjectFromAttribute(
    attribute: t.JSXAttribute | t.JSXSpreadAttribute,
): t.ObjectExpression | null {
    if (!t.isJSXAttribute(attribute)) return null;
    if (!t.isJSXIdentifier(attribute.name) || attribute.name.name !== 'style') return null;
    if (!t.isJSXExpressionContainer(attribute.value)) return null;
    return t.isObjectExpression(attribute.value.expression) ? attribute.value.expression : null;
}

/**
 * Test whether an object property declares a named CSS variable.
 * @param property - Candidate style object member.
 * @param varName - CSS variable name.
 * @returns Whether the property declares that variable.
 */
function isStyleVariableProperty(
    property: t.ObjectMethod | t.ObjectProperty | t.SpreadElement,
    varName: string,
): boolean {
    return (
        t.isObjectProperty(property) &&
        t.isStringLiteral(property.key) &&
        property.key.value === varName
    );
}

/**
 * Removes a CSS variable property from a JSX element's style attribute.
 *
 * @param element - The JSX opening element to modify
 * @param varName - The CSS variable name to remove
 */
function removeStyleVar(element: t.JSXOpeningElement, varName: string): void {
    for (let index = 0; index < element.attributes.length; index++) {
        const styleObj = styleObjectFromAttribute(element.attributes[index]);
        if (!styleObj) continue;
        styleObj.properties = styleObj.properties.filter(
            property => !isStyleVariableProperty(property, varName),
        );

        // If style object is empty, remove the entire style attribute
        if (styleObj.properties.length === 0) {
            element.attributes.splice(index, 1);
        }
        return;
    }
}

/**
 * Adds a CSS variable property to a JSX element's style attribute.
 * Creates the style attribute if it doesn't exist.
 *
 * @param element - The JSX opening element to modify
 * @param varName - The CSS variable name to add
 * @param valueExpr - The AST expression for the variable value
 */
function addStyleVar(element: t.JSXOpeningElement, varName: string, valueExpr: t.Expression): void {
    // Find existing style attribute
    for (const attr of element.attributes) {
        const styleObj = styleObjectFromAttribute(attr);
        if (!styleObj) continue;

        // Check if variable already exists
        const existing = styleObj.properties.some(property =>
            isStyleVariableProperty(property, varName),
        );
        if (!existing) {
            styleObj.properties.push(t.objectProperty(t.stringLiteral(varName), valueExpr));
        }
        return;
    }

    // No style attribute — create one
    element.attributes.push(
        t.jsxAttribute(
            t.jsxIdentifier('style'),
            t.jsxExpressionContainer(
                t.objectExpression([t.objectProperty(t.stringLiteral(varName), valueExpr)]),
            ),
        ),
    );
}

/**
 * Test whether an unknown AST field value is a Babel node.
 * @param value - Candidate AST field value.
 * @returns Whether the value has a node type discriminator.
 */
function isAstNode(value: unknown): value is t.Node {
    return Boolean(value && typeof value === 'object' && 'type' in value);
}

/**
 * Add node-valued AST fields to a parent map.
 * @param value - One AST field value.
 * @param parent - Node that owns the field.
 * @param map - Destination child-to-parent map.
 */
function mapNodeField(value: unknown, parent: t.Node, map: Map<t.Node, t.Node>): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            if (isAstNode(item)) mapNodeParents(item, parent, map);
        }
        return;
    }
    if (isAstNode(value)) mapNodeParents(value, parent, map);
}

/**
 * Group static CSS-variable usages by variable name and serialized value.
 *
 * @param usages All CSS variable usages collected during transform.
 * @returns Static usages grouped by variable identity and value.
 */
function groupStaticUsages(usages: CSSVarUsage[]): Map<string, CSSVarUsage[]> {
    const groups = new Map<string, CSSVarUsage[]>();
    for (const usage of usages) {
        if (usage.serializedValue === null) {
            continue;
        } // Can't hoist dynamic values
        const groupKey = `${usage.varName}::${usage.serializedValue}`;
        const group = groups.get(groupKey) || [];
        group.push(usage);
        groups.set(groupKey, group);
    }
    return groups;
}

/**
 * Find a non-fragment common ancestor for every usage in one static group.
 *
 * @param group Static usages that share an identity and value.
 * @param parentMap Child-to-parent AST relationships.
 * @returns Common JSX ancestor or null when no safe target exists.
 */
function findGroupLca(
    group: CSSVarUsage[],
    parentMap: Map<t.Node, t.Node>,
): t.JSXOpeningElement | null {
    let lca: t.JSXOpeningElement | null = group[0].element;
    for (let i = 1; i < group.length; i++) {
        const next = findLCA(lca, group[i].element, parentMap);
        if (next === null || isFragment(next)) {
            return null;
        }
        lca = next;
    }
    return lca;
}

/**
 * Hoists CSS variables to common ancestor elements when multiple siblings
 * share the same variable name and value.
 *
 * @param usages - All CSS variable usages collected during transform
 * @param parentMap - Map of child-to-parent relationships in the AST
 */
export function hoistCSSVariables(usages: CSSVarUsage[], parentMap: Map<t.Node, t.Node>): void {
    if (usages.length < 2) {
        return;
    }

    // For each group with 2+ elements, find LCA and hoist
    for (const [, group] of groupStaticUsages(usages)) {
        if (group.length < 2) {
            continue;
        }

        const lca = findGroupLca(group, parentMap);
        if (!lca) {
            continue;
        } // No valid LCA (Fragment or no common ancestor)

        // Hoist: add variable to LCA, remove from each child
        addStyleVar(lca, group[0].varName, group[0].valueExpr);
        for (const usage of group) {
            removeStyleVar(usage.element, usage.varName);
        }
    }
}

/**
 * Add one AST node and all of its child nodes to a parent map.
 *
 * @param node Current AST node.
 * @param parent Parent AST node, when present.
 * @param map Destination child-to-parent map.
 */
function mapNodeParents(node: t.Node, parent: t.Node | undefined, map: Map<t.Node, t.Node>): void {
    if (parent) {
        map.set(node, parent);
    }
    for (const key of Object.keys(node) as (keyof t.Node)[]) {
        const value = (node as unknown as Record<string, unknown>)[key];
        mapNodeField(value, node, map);
    }
}

/**
 * Builds a parent map for AST nodes (child-to-parent relationship).
 * Used by hoistCSSVariables to find LCA.
 *
 * @param ast - The root AST node to traverse
 * @returns A map of child-to-parent node relationships
 */
export function buildParentMap(ast: t.Node): Map<t.Node, t.Node> {
    const map = new Map<t.Node, t.Node>();
    mapNodeParents(ast, undefined, map);
    return map;
}
