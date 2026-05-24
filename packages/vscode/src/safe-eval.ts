import { parseExpression } from '@babel/parser';
import type { Expression, ObjectExpression, SpreadElement } from '@babel/types';

/**
 *
 */
type SafeValue = string | number | boolean | null | SafeValue[] | { [key: string]: SafeValue };

/**
 * @param node - AST node to extract a literal value from
 * @returns The extracted value, or undefined if the node type is unsupported
 */
function extractValue(node: Expression | SpreadElement): SafeValue | undefined {
    switch (node.type) {
        case 'NumericLiteral':
            return node.value;
        case 'StringLiteral':
            return node.value;
        case 'BooleanLiteral':
            return node.value;
        case 'NullLiteral':
            return null;
        case 'UnaryExpression':
            if (node.operator === '-' && node.argument.type === 'NumericLiteral') {
                return -node.argument.value;
            }
            return undefined;
        case 'ArrayExpression': {
            const arr: SafeValue[] = [];
            for (const el of node.elements) {
                if (!el) {
                    arr.push(null);
                    continue;
                }
                const v = extractValue(el);
                if (v === undefined) return undefined;
                arr.push(v);
            }
            return arr;
        }
        case 'ObjectExpression':
            return extractObjectNode(node);
        case 'TemplateLiteral':
            if (node.expressions.length === 0) {
                return node.quasis[0].value.cooked ?? undefined;
            }
            return undefined;
        default:
            return undefined;
    }
}

/**
 * @param node - ObjectExpression AST node
 * @returns Plain object with extracted key-value pairs, or undefined if any property is unsupported
 */
function extractObjectNode(node: ObjectExpression): Record<string, SafeValue> | undefined {
    const obj: Record<string, SafeValue> = {};
    for (const prop of node.properties) {
        if (prop.type !== 'ObjectProperty') return undefined;
        if (prop.computed) return undefined;

        let key: string;
        if (prop.key.type === 'Identifier') {
            key = prop.key.name;
        } else if (prop.key.type === 'StringLiteral') {
            key = prop.key.value;
        } else if (prop.key.type === 'NumericLiteral') {
            key = String(prop.key.value);
        } else {
            return undefined;
        }

        const value = extractValue(prop.value as Expression);
        if (value === undefined) return undefined;
        obj[key] = value;
    }
    return obj;
}

/**
 * @param src - JS object literal source text
 * @returns Parsed object or null if the source contains non-literal values
 */
export function parseObjectLiteralSafe(src: string): Record<string, SafeValue> | null {
    try {
        const ast = parseExpression(src, { sourceType: 'module' });
        if (ast.type !== 'ObjectExpression') return null;
        return extractObjectNode(ast) ?? null;
    } catch {
        return null;
    }
}
