/**
 * Phase D production transform — `transformOxc()` is the oxc-parser +
 * magic-string replacement for `transformSourceCode()` (Babel). The
 * port lands incrementally across slices D2.1 (extract only),
 * D2.2 (magic-string rewrite), D2.3 (szRecover), D2.4 (runtime calls),
 * D2.5 (spread/conditional hoisting). The parity harness at
 * `tests/oxc-parity.test.ts` tracks which slices have landed.
 *
 * **Current slice: D2.1.** Read-only class extraction. Walks the AST
 * for JSXAttribute name="sz" with a static `ObjectExpression` value,
 * converts each property tree into a plain {@link SzObject}, and runs
 * the browser-pure `transform()` (`transform-core.ts`) to derive the
 * Tailwind class names. The source string is returned untouched —
 * `code === source` and `transformed === false`. D2.2 will replace
 * the matched JSXAttribute ranges via magic-string.
 *
 * Anything D2.1 cannot handle statically (variables, spread, ternary,
 * template literals, runtime helper calls) throws
 * {@link OxcNotImplementedError} so the parity harness records the
 * fixture as `pending` rather than reporting silent divergence.
 *
 * See `.agent/planning/babel-to-oxc-mapping.md` for the Babel → oxc
 * API mapping referenced throughout this file.
 */

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import type { TokenData } from './manifest.js';
import type { TransformSourceCodeOptions } from './transform.js';
import { transform as compileSzObject, type SzObject, type SzValue } from './transform-core.js';

/**
 * Result shape returned by both `transformSourceCode` (Babel) and the
 * future `transformOxc`. Kept in lock-step so the parity harness can
 * diff results without conditional logic.
 */
export interface TransformOxcResult {
    /** Rewritten source — equal to input when `transformed === false`. */
    code: string;
    /** True when at least one sz/szRecover/_sz mutation was applied. */
    transformed: boolean;
    /** Did the file pull in `_sz` runtime helper? */
    usesRuntime: boolean;
    /** Did the file pull in `_szMerge` runtime helper? */
    usesMerge: boolean;
    /** Did the file use color-var helpers? */
    usesColorVar: boolean;
    /** Class names emitted by the compiler — drives the mangle map. */
    classes: Set<string>;
    /** Hand-written `className="..."` strings — TW JIT safelist only. */
    rawClassNames: Set<string>;
    /** Dev-mode warnings emitted during transform. */
    diagnostics: string[];
    /** Recovery tokens emitted by szRecover attributes. */
    recoveryTokens: Map<string, TokenData>;
}

/**
 * Thrown when a caller hits a code path the current slice does not yet
 * implement. The parity harness catches this and reports the fixture
 * as `pending` rather than failing the suite.
 */
export class OxcNotImplementedError extends Error {
    /**
     * @param slice The Phase D slice expected to implement this path.
     * @param detail What the caller asked for that is not yet wired.
     */
    constructor(slice: string, detail: string) {
        super(`transformOxc: ${slice} not implemented yet — ${detail}`);
        this.name = 'OxcNotImplementedError';
    }
}

/**
 * Transform a TSX/JSX source string using oxc-parser + magic-string.
 *
 * @param source The source code to transform.
 * @param filename Optional filename, drives JSX detection in oxc-parser.
 * @param _options Optional overrides; D2.1 ignores them (no AST budget yet).
 * @returns Transform result matching {@link TransformOxcResult}.
 * @throws {OxcNotImplementedError} when a fixture needs a later slice.
 */
export function transformOxc(
    source: string,
    filename?: string,
    _options?: TransformSourceCodeOptions,
): TransformOxcResult {
    const classes = new Set<string>();
    const rawClassNames = new Set<string>();
    const diagnostics: string[] = [];
    const recoveryTokens = new Map<string, TokenData>();

    if (!source.includes('sz')) {
        return {
            code: source,
            transformed: false,
            usesRuntime: false,
            usesMerge: false,
            usesColorVar: false,
            classes,
            rawClassNames,
            diagnostics,
            recoveryTokens,
        };
    }

    const effectiveFilename = filename ?? 'file.tsx';
    const parsed = parseSync(effectiveFilename, source);
    if (parsed.errors.length > 0) {
        throw new Error(
            `oxc-parser errors in ${effectiveFilename}: ` +
                parsed.errors.map(e => e.message).join('; '),
        );
    }

    const edits = new MagicString(source);
    let transformed = false;

    walk(parsed.program, node => {
        if (node.type !== 'JSXOpeningElement') {
            return;
        }
        const openingNode = node as unknown as JsxOpeningElementNode;
        const attrs = openingNode.attributes ?? [];
        const szAttrs: JsxAttributeNode[] = [];
        let classNameAttr: JsxAttributeNode | null = null;

        for (const attrRaw of attrs) {
            if (attrRaw.type !== 'JSXAttribute') {
                continue;
            }
            const attr = attrRaw as JsxAttributeNode;
            const name = attr.name?.name;
            if (name === 'sz') {
                szAttrs.push(attr);
            } else if (name === 'className' || name === 'class') {
                classNameAttr = attr;
            }
        }

        if (classNameAttr) {
            const rawValue = stringLiteralValue(classNameAttr.value);
            if (rawValue !== null) {
                for (const c of rawValue.split(/\s+/)) {
                    if (c) {
                        rawClassNames.add(c);
                    }
                }
            }
        }

        if (szAttrs.length === 0) {
            return;
        }

        const szDerived: string[] = [];
        for (const szAttr of szAttrs) {
            const value = szAttr.value;
            if (!value || value.type !== 'JSXExpressionContainer') {
                throw new OxcNotImplementedError(
                    'D2.1',
                    `sz attribute without object expression at ${effectiveFilename}:${szAttr.start}`,
                );
            }
            const expression = (value as unknown as { expression: OxcNode }).expression;
            if (expression.type !== 'ObjectExpression') {
                throw new OxcNotImplementedError(
                    'D2.1',
                    `sz expression is not an inline object literal at ${effectiveFilename}:${expression.start}`,
                );
            }
            const szObj = astObjectToSzObject(
                expression as ObjectExpressionNode,
                effectiveFilename,
            );
            const result = compileSzObject(szObj);
            for (const c of result.className.split(/\s+/)) {
                if (c) {
                    szDerived.push(c);
                    classes.add(c);
                }
            }
        }

        // Merge classes: existing className value first, then sz-derived.
        // This matches the order Babel produces in `transform.ts:228-371`.
        const existingRaw = classNameAttr ? stringLiteralValue(classNameAttr.value) : null;
        const mergedClasses = [
            ...(existingRaw ? existingRaw.split(/\s+/).filter(Boolean) : []),
            ...szDerived,
        ];
        const mergedAttr = `className="${mergedClasses.join(' ')}"`;

        if (classNameAttr) {
            // Replace className value (or whole attribute) in place, then
            // delete each sz attribute + the whitespace preceding it.
            edits.overwrite(classNameAttr.start, classNameAttr.end, mergedAttr);
            for (const szAttr of szAttrs) {
                const deleteStart = whitespaceStart(source, szAttr.start);
                edits.remove(deleteStart, szAttr.end);
            }
        } else {
            // No existing className — first sz becomes the className,
            // subsequent sz attributes (rare) are deleted with whitespace.
            const [firstSz, ...rest] = szAttrs;
            if (!firstSz) {
                return;
            }
            edits.overwrite(firstSz.start, firstSz.end, mergedAttr);
            for (const szAttr of rest) {
                const deleteStart = whitespaceStart(source, szAttr.start);
                edits.remove(deleteStart, szAttr.end);
            }
        }
        transformed = true;
    });

    return {
        code: transformed ? edits.toString() : source,
        transformed,
        usesRuntime: false,
        usesMerge: false,
        usesColorVar: false,
        classes,
        rawClassNames,
        diagnostics,
        recoveryTokens,
    };
}

/**
 * Extract the string value of a JSXAttribute when it is a plain
 * string literal (`className="foo"`). Returns null for expression
 * containers, missing values, or non-string literals.
 *
 * @param value The attribute value AST node.
 * @returns The raw string content, or null.
 */
function stringLiteralValue(value: OxcNode | null): string | null {
    if (!value) {
        return null;
    }
    if (value.type === 'Literal') {
        const v = (value as unknown as { value: unknown }).value;
        return typeof v === 'string' ? v : null;
    }
    return null;
}

/**
 * Walk back from `attrStart` over whitespace characters so a deleted
 * attribute also removes the space that preceded it (`<div a b/>` →
 * `<div a/>`, not `<div a  />`).
 *
 * @param source The full source string.
 * @param attrStart Start offset of the attribute node.
 * @returns Earliest offset such that everything up to attrStart is whitespace.
 */
function whitespaceStart(source: string, attrStart: number): number {
    let idx = attrStart;
    while (idx > 0 && /\s/.test(source.charAt(idx - 1))) {
        idx--;
    }
    return idx;
}

/** Minimum surface of an oxc AST node we rely on in this file. */
interface OxcNode {
    type: string;
    start: number;
    end: number;
    [key: string]: unknown;
}

/** oxc shape for a JSX attribute (`sz={...}`, `className="..."`, etc). */
interface JsxAttributeNode extends OxcNode {
    type: 'JSXAttribute';
    name: { type: string; name?: string };
    value: OxcNode | null;
}

/** oxc shape for a JSX opening element (`<div ...>` or `<div ... />`). */
interface JsxOpeningElementNode extends OxcNode {
    type: 'JSXOpeningElement';
    attributes: OxcNode[];
    selfClosing: boolean;
}

/** oxc shape for an object literal expression (`{ p: 4 }`). */
interface ObjectExpressionNode extends OxcNode {
    type: 'ObjectExpression';
    properties: OxcNode[];
}

/** oxc shape for a single property inside an ObjectExpression. */
interface PropertyNode extends OxcNode {
    type: 'Property';
    key: OxcNode;
    value: OxcNode;
    computed: boolean;
    shorthand: boolean;
}

/**
 * Convert an oxc `ObjectExpression` AST node into a plain {@link SzObject}
 * the browser-pure `transform()` helper can consume. Throws
 * {@link OxcNotImplementedError} on any pattern D2.1 does not handle
 * (identifiers, spreads, ternaries, template literals, methods).
 *
 * @param node The oxc ObjectExpression node.
 * @param filename Filename for diagnostic offsets.
 * @returns Plain JS object with literal values.
 */
function astObjectToSzObject(node: ObjectExpressionNode, filename: string): SzObject {
    const result: Record<string, SzValue> = {};
    for (const propRaw of node.properties) {
        if (propRaw.type !== 'Property') {
            throw new OxcNotImplementedError(
                'D2.1',
                `non-Property in sz object (e.g. SpreadElement) at ${filename}:${propRaw.start}`,
            );
        }
        const prop = propRaw as PropertyNode;
        if (prop.computed) {
            throw new OxcNotImplementedError(
                'D2.1',
                `computed key in sz object at ${filename}:${prop.key.start}`,
            );
        }
        const key = extractKeyName(prop.key);
        if (key === null) {
            throw new OxcNotImplementedError(
                'D2.1',
                `unsupported key shape ${prop.key.type} at ${filename}:${prop.key.start}`,
            );
        }
        result[key] = astValueToSzValue(prop.value, filename);
    }
    return result as SzObject;
}

/**
 * Extract a string key name from a Property's key node.
 *
 * @param key The key node (Identifier or Literal).
 * @returns Key name string, or null if shape is unsupported.
 */
function extractKeyName(key: OxcNode): string | null {
    if (key.type === 'Identifier') {
        return String((key as unknown as { name: string }).name);
    }
    if (key.type === 'Literal') {
        const value = (key as unknown as { value: unknown }).value;
        if (typeof value === 'string' || typeof value === 'number') {
            return String(value);
        }
    }
    return null;
}

/**
 * Convert an oxc value AST node into a plain {@link SzValue}.
 * Handles string/number/boolean literals and nested objects. Anything
 * else throws {@link OxcNotImplementedError} for D2.1.
 *
 * @param node The value AST node.
 * @param filename Filename for diagnostic offsets.
 * @returns Plain JS value usable by `transform()`.
 */
function astValueToSzValue(node: OxcNode, filename: string): SzValue {
    if (node.type === 'Literal') {
        const value = (node as unknown as { value: unknown }).value;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        throw new OxcNotImplementedError(
            'D2.1',
            `unsupported literal value type at ${filename}:${node.start}`,
        );
    }
    if (node.type === 'UnaryExpression') {
        // Handles negative number literals like `-1` (parsed as
        // UnaryExpression { operator: '-', argument: Literal }).
        const operator = (node as unknown as { operator: string }).operator;
        const argument = (node as unknown as { argument: OxcNode }).argument;
        if (operator === '-' && argument.type === 'Literal') {
            const argValue = (argument as unknown as { value: unknown }).value;
            if (typeof argValue === 'number') {
                return -argValue;
            }
        }
        throw new OxcNotImplementedError(
            'D2.1',
            `unsupported unary expression at ${filename}:${node.start}`,
        );
    }
    if (node.type === 'ObjectExpression') {
        return astObjectToSzObject(node as ObjectExpressionNode, filename);
    }
    if (node.type === 'Identifier' || node.type === 'MemberExpression') {
        throw new OxcNotImplementedError(
            'D2.1',
            `identifier reference in sz object — scope resolution lands in a later slice (${filename}:${node.start})`,
        );
    }
    if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
        throw new OxcNotImplementedError(
            'D2.5',
            `conditional/logical expression in sz object at ${filename}:${node.start}`,
        );
    }
    throw new OxcNotImplementedError(
        'D2.1',
        `unsupported value node type ${node.type} at ${filename}:${node.start}`,
    );
}

/**
 * Hand-rolled depth-first AST walker. Replaces a Babel `traverse` call
 * for the read-only D2.1 scope — D2.2+ may upgrade to a parent-tracking
 * walker once magic-string edits need parent ranges (see
 * `.agent/planning/babel-to-oxc-mapping.md` § 4.1).
 *
 * @param node Root AST node.
 * @param visit Function called for every visited node.
 */
function walk(node: unknown, visit: (node: OxcNode) => void): void {
    if (!node || typeof node !== 'object') {
        return;
    }
    const typed = node as OxcNode;
    if (typeof typed.type !== 'string') {
        return;
    }
    visit(typed);
    for (const key of Object.keys(typed)) {
        if (
            key === 'loc' ||
            key === 'range' ||
            key === 'start' ||
            key === 'end' ||
            key === 'type'
        ) {
            continue;
        }
        const child = (typed as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                walk(item, visit);
            }
        } else if (child && typeof child === 'object') {
            walk(child, visit);
        }
    }
}
