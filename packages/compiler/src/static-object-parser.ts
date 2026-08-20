import { parseSync } from 'oxc-parser';

import type { SzObject } from './transform-core.js';

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
 * Collects why a walk gave up.
 *
 * The extractors already stop at the first dynamic node; this only records
 * what that node was on the way out, so the yes/no answer and the explanation
 * come from one traversal and cannot disagree about what "dynamic" means.
 */
interface Rejection {
    reason?: string;
}

/**
 * Record the first reason a walk gave up, and report failure to the caller.
 *
 * Only the first is kept: it is the innermost node that actually stopped the
 * walk, so it points at the value someone has to change rather than at the
 * outer object that merely contains it.
 *
 * @param out - Rejection collector for this parse.
 * @param reason - Why this node cannot be resolved statically.
 * @returns Always undefined, so callers can `return reject(...)`.
 */
function reject(out: Rejection, reason: string): undefined {
    out.reason ??= reason;
    return undefined;
}

/**
 * Extract a supported unary numeric literal.
 * @param node - Unary expression node.
 * @param out - Collector the first rejection reason is recorded into.
 * @returns Folded negative number, or undefined when unsupported.
 */
function extractUnaryValue(node: OxcNode, out: Rejection): number | undefined {
    const argument = node.argument as OxcNode;
    if (node.operator !== '-') {
        return reject(out, `the unary operator "${String(node.operator)}" is dynamic`);
    }
    if (argument.type !== 'Literal' || typeof argument.value !== 'number') {
        return reject(out, 'a negated non-number is dynamic');
    }
    return -argument.value;
}

/**
 * Extract a static array while preserving sparse holes as null.
 * @param node - Array expression node.
 * @param out - Collector the first rejection reason is recorded into.
 * @returns Extracted values, or undefined when any element is dynamic.
 */
function extractArrayValue(node: OxcNode, out: Rejection): StaticValue[] | undefined {
    const values: StaticValue[] = [];
    for (const element of (node.elements as OxcNode[]) ?? []) {
        if (!element) {
            values.push(null);
            continue;
        }
        if (element.type === 'SpreadElement') return reject(out, 'a spread is dynamic');
        const value = extractStaticValue(element, out);
        if (value === undefined) return undefined;
        values.push(value);
    }
    return values;
}

/**
 * Extract a template literal only when it has no interpolation.
 * @param node - Template literal node.
 * @param out - Collector the first rejection reason is recorded into.
 * @returns Static cooked text, or undefined for interpolated templates.
 */
function extractTemplateValue(node: OxcNode, out: Rejection): string | undefined {
    if (((node.expressions as unknown[]) ?? []).length > 0) {
        return reject(out, 'a template literal with interpolation is dynamic');
    }
    const quasis = node.quasis as OxcNode[];
    return ((quasis[0].value as OxcNode).cooked as string) ?? undefined;
}

/**
 * Extract one supported literal/object/array AST value.
 * @param node - Candidate expression node.
 * @param out - Collector the first rejection reason is recorded into.
 * @returns Static value, or undefined for dynamic syntax.
 */
function extractStaticValue(node: OxcNode, out: Rejection): StaticValue | undefined {
    switch (node.type) {
        case 'Literal':
            return node.value as StaticValue;
        case 'UnaryExpression':
            return extractUnaryValue(node, out);
        case 'ArrayExpression':
            return extractArrayValue(node, out);
        case 'ObjectExpression':
            return extractObjectValue(node, out);
        case 'TemplateLiteral':
            return extractTemplateValue(node, out);
        default:
            return reject(out, `"${String(node.type)}" is dynamic`);
    }
}

/**
 * Extract a supported static object property key.
 * @param node - Candidate property key node.
 * @param out - Collector the first rejection reason is recorded into.
 * @returns Normalized string key, or undefined when unsupported.
 */
function extractPropertyKey(node: OxcNode, out: Rejection): string | undefined {
    if (node.type === 'Identifier') return node.name as string;
    if (node.type !== 'Literal') return reject(out, `a "${String(node.type)}" key is dynamic`);
    if (typeof node.value === 'string') return node.value;
    if (typeof node.value === 'number') return String(node.value);
    return reject(out, 'a key that is neither a string nor a number is dynamic');
}

/**
 * Extract a recursively static object expression.
 * @param node - Object expression node.
 * @param out - Collector the first rejection reason is recorded into.
 * @returns Extracted object, or undefined when any member is dynamic.
 */
function extractObjectValue(
    node: OxcNode,
    out: Rejection,
): Record<string, StaticValue> | undefined {
    const result: Record<string, StaticValue> = {};
    for (const property of (node.properties as OxcNode[]) ?? []) {
        if (property.type === 'SpreadElement') return reject(out, 'a spread is dynamic');
        if (property.computed === true) return reject(out, 'a computed key is dynamic');
        if (property.type !== 'Property') {
            return reject(out, `"${String(property.type)}" is dynamic`);
        }
        if (property.method === true) return reject(out, 'an object method is dynamic');
        const key = extractPropertyKey(property.key as OxcNode, out);
        if (key === undefined) return undefined;
        const value = extractStaticValue(property.value as OxcNode, out);
        if (value === undefined) return undefined;
        result[key] = value;
    }
    return result;
}

/** The outcome of reading one object-literal source. */
export type StaticObjectResult =
    | {
          /** The extracted object. */
          value: SzObject;
      }
    | {
          /** Why the source could not be resolved statically. */
          reason: string;
      };

/**
 * Parse a recursively static JavaScript object literal, saying why on failure.
 *
 * The reason names the innermost node that stopped the walk, so it points at
 * the value somebody has to change rather than at the object containing it.
 *
 * @param source - Object literal source.
 * @returns The parsed object, or the reason it is not static.
 */
export function explainStaticObjectLiteral(source: string): StaticObjectResult {
    let parsed: ReturnType<typeof parseSync>;
    try {
        parsed = parseSync('sz.js', `const _=${source.trim()}`);
    } catch {
        return { reason: 'could not be parsed as a JavaScript expression' };
    }
    if (parsed.errors.length > 0) {
        return { reason: 'could not be parsed as a JavaScript expression' };
    }

    const out: Rejection = {};
    try {
        const body = (parsed.program as unknown as OxcNode).body as OxcNode[];
        const declaration = (body[0].declarations as OxcNode[])[0];
        const initializer = declaration.init as OxcNode | undefined;
        if (initializer?.type !== 'ObjectExpression') return { reason: 'not an object literal' };
        const value = extractObjectValue(initializer, out) as SzObject | undefined;
        if (value === undefined) {
            return { reason: out.reason ?? 'contains a value that is not static' };
        }
        return { value };
    } catch {
        return { reason: 'could not be parsed as a JavaScript expression' };
    }
}

/**
 * Parse a recursively static JavaScript object literal for framework adapters.
 *
 * A thin reading of {@link explainStaticObjectLiteral} for callers that only
 * need yes or no — an adapter leaves a dynamic attribute to the runtime and
 * has nothing to tell anybody about it.
 *
 * @param source - Object literal source.
 * @returns Parsed sz object, or null for dynamic/invalid syntax.
 */
export function parseStaticObjectLiteral(source: string): SzObject | null {
    const result = explainStaticObjectLiteral(source);
    return 'value' in result ? result.value : null;
}
