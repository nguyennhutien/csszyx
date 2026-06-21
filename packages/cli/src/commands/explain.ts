/**
 * csszyx explain — print the Tailwind className(s) an sz object compiles to.
 *
 * A verification one-liner: paste an sz object literal and see exactly what
 * csszyx emits, without setting up a build or grepping the bundle.
 *
 *   csszyx explain "{ p: 4, bg: 'blue-500', hover: { bg: 'blue-700' } }"
 *   → p-4 bg-blue-500 hover:bg-blue-700
 */

import { parseExpression } from '@babel/parser';
import type { ArrayExpression, Expression, ObjectExpression, PrivateName } from '@babel/types';
import { transform } from '@csszyx/compiler';

import { printError } from '../utils/terminal-ui.js';

/** Thrown when the argument is not a statically-resolvable sz object literal. */
export class ExplainParseError extends Error {}

/**
 * Convert a literal-only Babel expression node into its plain JS value.
 * Only literals/objects/arrays are accepted — identifiers, calls, spreads and
 * other dynamic forms are rejected (they can't be resolved without running the
 * program, which is exactly what `explain` avoids). No eval is used.
 * @param node - The expression node to convert.
 * @returns The plain JS value.
 */
function literalToValue(node: Expression | PrivateName): unknown {
    switch (node.type) {
        case 'StringLiteral':
            return node.value;
        case 'NumericLiteral':
            return node.value;
        case 'BooleanLiteral':
            return node.value;
        case 'NullLiteral':
            return null;
        case 'UnaryExpression':
            if (node.operator === '-' && node.argument.type === 'NumericLiteral') {
                return -node.argument.value;
            }
            throw new ExplainParseError(`unsupported unary expression "${node.operator}"`);
        case 'TemplateLiteral':
            if (node.expressions.length === 0 && node.quasis.length === 1) {
                return node.quasis[0]?.value.cooked ?? '';
            }
            throw new ExplainParseError('template literals with interpolation are dynamic');
        case 'ArrayExpression':
            return arrayToValue(node);
        case 'ObjectExpression':
            return objectToValue(node);
        default:
            throw new ExplainParseError(
                `"${node.type}" is dynamic — explain only resolves static literals`,
            );
    }
}

/**
 * Convert an array-expression node into a plain array.
 * @param node - The array expression.
 * @returns The plain array.
 */
function arrayToValue(node: ArrayExpression): unknown[] {
    return node.elements.map(element => {
        if (element === null) {
            throw new ExplainParseError('array holes are not supported');
        }
        if (element.type === 'SpreadElement') {
            throw new ExplainParseError('spreads are dynamic and cannot be explained');
        }
        return literalToValue(element);
    });
}

/**
 * Convert an object-expression node into a plain object.
 * @param node - The object expression.
 * @returns The plain object.
 */
function objectToValue(node: ObjectExpression): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const property of node.properties) {
        if (property.type !== 'ObjectProperty') {
            throw new ExplainParseError('object methods/spreads are dynamic');
        }
        if (property.computed) {
            throw new ExplainParseError('computed keys are dynamic');
        }
        const { key } = property;
        const name =
            key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : null;
        if (name === null) {
            throw new ExplainParseError(`unsupported key type "${key.type}"`);
        }
        if (property.value.type === 'AssignmentPattern' || property.value.type === 'RestElement') {
            throw new ExplainParseError('pattern values are not supported');
        }
        result[name] = literalToValue(property.value as Expression);
    }
    return result;
}

/**
 * Resolve an sz object literal string to the Tailwind className it compiles to.
 * @param input - The sz object literal source, e.g. "{ p: 4, bg: 'blue-500' }".
 * @returns The compiled className string.
 */
export function explainSz(input: string): string {
    let expression: Expression;
    try {
        expression = parseExpression(input, { plugins: ['typescript'] });
    } catch {
        throw new ExplainParseError('could not parse the sz argument as a JS expression');
    }
    if (expression.type !== 'ObjectExpression') {
        throw new ExplainParseError('sz must be an object literal, e.g. "{ p: 4 }"');
    }
    const object = objectToValue(expression);
    const result = transform(object as Parameters<typeof transform>[0]);
    return typeof result === 'string' ? result : result.className;
}

/**
 * `csszyx explain` command — prints the className for an sz object literal.
 * @param sz - The sz object literal source string.
 */
export function explain(sz: string): void {
    let className: string;
    try {
        className = explainSz(sz);
    } catch (error) {
        const reason = error instanceof ExplainParseError ? error.message : String(error);
        printError(`Could not explain sz: ${reason}`);
        process.exitCode = 1;
        return;
    }
    console.log(className === '' ? '(no classes)' : className);
}
