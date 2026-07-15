import { parseSync } from 'oxc-parser';

import type { SzObject } from './transform.js';

/** Recursively supported value domain for adapter object literals. */
type StaticValue =
    | string
    | number
    | boolean
    | null
    | StaticValue[]
    | { [key: string]: StaticValue };
/** Minimal structural view used to traverse Oxc ESTree nodes. */
type OxcNode = Record<string, unknown>;

/**
 * Extract a supported unary numeric literal.
 * @param node - Unary expression node.
 * @returns Folded negative number, or undefined when unsupported.
 */
function extractUnaryValue(node: OxcNode): number | undefined {
    const argument = node.argument as OxcNode;
    if (node.operator !== '-' || argument.type !== 'Literal') return undefined;
    return typeof argument.value === 'number' ? -argument.value : undefined;
}

/**
 * Extract a static array while preserving sparse holes as null.
 * @param node - Array expression node.
 * @returns Extracted values, or undefined when any element is dynamic.
 */
function extractArrayValue(node: OxcNode): StaticValue[] | undefined {
    const values: StaticValue[] = [];
    for (const element of (node.elements as OxcNode[]) ?? []) {
        if (!element) {
            values.push(null);
            continue;
        }
        const value = extractStaticValue(element);
        if (value === undefined) return undefined;
        values.push(value);
    }
    return values;
}

/**
 * Extract a template literal only when it has no interpolation.
 * @param node - Template literal node.
 * @returns Static cooked text, or undefined for interpolated templates.
 */
function extractTemplateValue(node: OxcNode): string | undefined {
    if (((node.expressions as unknown[]) ?? []).length > 0) return undefined;
    const quasis = node.quasis as OxcNode[];
    return ((quasis[0].value as OxcNode).cooked as string) ?? undefined;
}

/**
 * Extract one supported literal/object/array AST value.
 * @param node - Candidate expression node.
 * @returns Static value, or undefined for dynamic syntax.
 */
function extractStaticValue(node: OxcNode): StaticValue | undefined {
    switch (node.type) {
        case 'Literal':
            return node.value as StaticValue;
        case 'UnaryExpression':
            return extractUnaryValue(node);
        case 'ArrayExpression':
            return extractArrayValue(node);
        case 'ObjectExpression':
            return extractObjectValue(node);
        case 'TemplateLiteral':
            return extractTemplateValue(node);
        default:
            return undefined;
    }
}

/**
 * Extract a supported static object property key.
 * @param node - Candidate property key node.
 * @returns Normalized string key, or undefined when unsupported.
 */
function extractPropertyKey(node: OxcNode): string | undefined {
    if (node.type === 'Identifier') return node.name as string;
    if (node.type !== 'Literal') return undefined;
    if (typeof node.value === 'string') return node.value;
    if (typeof node.value === 'number') return String(node.value);
    return undefined;
}

/**
 * Extract a recursively static object expression.
 * @param node - Object expression node.
 * @returns Extracted object, or undefined when any member is dynamic.
 */
function extractObjectValue(node: OxcNode): Record<string, StaticValue> | undefined {
    const result: Record<string, StaticValue> = {};
    for (const property of (node.properties as OxcNode[]) ?? []) {
        if (property.type !== 'Property' || property.computed) return undefined;
        const key = extractPropertyKey(property.key as OxcNode);
        if (key === undefined) return undefined;
        const value = extractStaticValue(property.value as OxcNode);
        if (value === undefined) return undefined;
        result[key] = value;
    }
    return result;
}

/**
 * Parse a recursively static JavaScript object literal for framework adapters.
 * @param source - Object literal source.
 * @returns Parsed sz object, or null for dynamic/invalid syntax.
 */
export function parseStaticObjectLiteral(source: string): SzObject | null {
    try {
        const parsed = parseSync('sz.js', `const _=${source.trim()}`);
        if (parsed.errors.length > 0) return null;
        const body = (parsed.program as unknown as OxcNode).body as OxcNode[];
        const declaration = (body[0].declarations as OxcNode[])[0];
        const initializer = declaration.init as OxcNode | undefined;
        if (initializer?.type !== 'ObjectExpression') return null;
        return (extractObjectValue(initializer) as SzObject) ?? null;
    } catch {
        return null;
    }
}
