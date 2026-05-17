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

import { AST_BUDGET, ASTBudgetExceededError } from './ast-budget.js';
import type { TokenData } from './manifest.js';
import {
    COLOR_PROPERTIES,
    getCSSVariableName,
    getPropertyCategory,
    PropertyCategory,
} from './property-types.js';
import { generateInlineRecoveryToken, isValidInlineRecoveryMode } from './recovery-tokens.js';
import type { TransformSourceCodeOptions } from './transform.js';
import {
    transform as compileSzObject,
    getVariantPrefix,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    type SzObject,
    type SzValue,
} from './transform-core.js';

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
 * @param options Optional overrides such as the AST node budget.
 * @returns Transform result matching {@link TransformOxcResult}.
 * @throws {OxcNotImplementedError} when a fixture needs a later slice.
 */
export function transformOxc(
    source: string,
    filename?: string,
    options?: TransformSourceCodeOptions,
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
    const astBudget = options?.astBudget ?? AST_BUDGET;
    const parsed = parseSync(effectiveFilename, source);
    if (parsed.errors.length > 0) {
        throw new Error(
            `oxc-parser errors in ${effectiveFilename}: ` +
                parsed.errors.map(e => e.message).join('; '),
        );
    }
    assertAstBudget(parsed.program as unknown as OxcNode, effectiveFilename, astBudget);

    const edits = new MagicString(source);
    const objectBindings = collectObjectBindings(parsed.program as unknown as OxcNode);
    const conditionalBindings = collectConditionalBindings(parsed.program as unknown as OxcNode);
    let transformed = false;
    let usesRuntime = false;
    let usesMerge = false;
    let usesColorVar = false;

    walk(parsed.program, node => {
        if (node.type === 'CallExpression') {
            collectDynamicCallClasses(
                node as CallExpressionNode,
                effectiveFilename,
                objectBindings,
                classes,
            );
            return;
        }
        if (node.type !== 'JSXOpeningElement') {
            return;
        }
        const openingNode = node as unknown as JsxOpeningElementNode;
        const attrs = openingNode.attributes ?? [];
        const szAttrs: JsxAttributeNode[] = [];
        let classNameAttr: JsxAttributeNode | null = null;
        let styleAttr: JsxAttributeNode | null = null;
        let szRecoverAttr: JsxAttributeNode | null = null;
        let alreadyTagged = false;
        let lastAttr: JsxAttributeNode | null = null;

        for (const attrRaw of attrs) {
            if (attrRaw.type !== 'JSXAttribute') {
                continue;
            }
            const attr = attrRaw as JsxAttributeNode;
            lastAttr = attr;
            const name = attr.name?.name;
            if (name === 'sz') {
                szAttrs.push(attr);
            } else if (name === 'className' || name === 'class') {
                classNameAttr = attr;
            } else if (name === 'style') {
                styleAttr = attr;
            } else if (name === 'szRecover') {
                szRecoverAttr = attr;
            } else if (name === 'data-sz-recovery-token') {
                alreadyTagged = true;
            }
        }

        // szRecover handling (mirrors transform.ts:152-219). Emits an
        // inline recovery token + appends a `data-sz-recovery-token`
        // attribute. Idempotent across HMR re-runs via `alreadyTagged`.
        if (szRecoverAttr && !alreadyTagged) {
            const recoverValue = stringLiteralValue(szRecoverAttr.value);
            if (recoverValue === null) {
                diagnostics.push(
                    `[csszyx] szRecover at ${effectiveFilename}: ` +
                        'only string-literal values ("csr" | "dev-only") are supported. ' +
                        'Dynamic values disable token emission for this element.',
                );
            } else if (!isValidInlineRecoveryMode(recoverValue)) {
                diagnostics.push(
                    `[csszyx] szRecover at ${effectiveFilename}: ` +
                        `unknown mode "${recoverValue}" — expected "csr" or "dev-only". ` +
                        'Token emission skipped.',
                );
            } else {
                const elementType = extractElementName(openingNode.name);
                // Babel uses the szRecover attribute's loc (see
                // `transform.ts:190` — `path.node.loc`), NOT the opening
                // element's. Matching that ensures token hashes line up
                // byte-for-byte with the existing manifest format.
                const { line, column } = offsetToLineColumn(source, szRecoverAttr.start);
                const token = generateInlineRecoveryToken(
                    effectiveFilename,
                    line,
                    column,
                    elementType,
                );
                // Insert the new attribute after the last existing one,
                // before the (possibly self-closing) tag terminator. Use
                // `appendRight` (not `appendLeft`) because a later
                // `overwrite()` of the same range — when `sz` is the last
                // attribute — wipes any prior `appendLeft` at its end
                // boundary but leaves `appendRight` intact.
                if (lastAttr) {
                    edits.appendRight(lastAttr.end, ` data-sz-recovery-token="${token}"`);
                }
                recoveryTokens.set(token, {
                    mode: recoverValue,
                    component: elementType,
                    path: `${effectiveFilename}:${line}:${column}`,
                });
                transformed = true;
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

        // Try to statically extract every sz attribute. The first
        // attribute that can't be analysed (spread / identifier /
        // ternary / etc.) flips this element into the runtime fallback
        // path — Babel does the same at `transform.ts:745-786` via
        // `tryStaticTransformNode()` → `_sz(...)` emission.
        const szDerived: string[] = [];
        let runtimeFallbackExpr: OxcNode | null = null;
        let runtimeFallbackAttr: JsxAttributeNode | null = null;
        for (const szAttr of szAttrs) {
            const value = szAttr.value;
            if (!value) {
                throw new OxcNotImplementedError(
                    'D3',
                    `sz attribute without value at ${effectiveFilename}:${szAttr.start}`,
                );
            }
            const stringValue = stringLiteralValue(value);
            if (stringValue !== null) {
                for (const c of stringValue.split(/\s+/)) {
                    if (c) {
                        szDerived.push(c);
                        classes.add(c);
                    }
                }
                continue;
            }
            if (value.type !== 'JSXExpressionContainer') {
                throw new OxcNotImplementedError(
                    'D3',
                    `unsupported sz attribute value ${value.type} at ${effectiveFilename}:${szAttr.start}`,
                );
            }
            const expression = (value as unknown as { expression: OxcNode }).expression;
            if (expression.type === 'ConditionalExpression') {
                const conditionalClassExpr = buildStaticConditionalClassExpression(
                    expression as ConditionalExpressionNode,
                    effectiveFilename,
                    objectBindings,
                    source,
                    classes,
                );
                if (conditionalClassExpr) {
                    if (classNameAttr || szAttrs.length > 1) {
                        runtimeFallbackExpr = expression;
                        runtimeFallbackAttr = szAttr;
                        break;
                    }
                    edits.overwrite(
                        szAttr.start,
                        szAttr.end,
                        `className={${conditionalClassExpr}}`,
                    );
                    transformed = true;
                    return;
                }
            }
            if (expression.type === 'Identifier') {
                const identifierName = String((expression as IdentifierNode).name);
                const bound = objectBindings.get(identifierName);
                if (bound) {
                    const result = compileSzObject(
                        astObjectToSzObject(bound, effectiveFilename, objectBindings),
                    );
                    for (const c of result.className.split(/\s+/)) {
                        if (c) {
                            szDerived.push(c);
                            classes.add(c);
                        }
                    }
                    continue;
                }
                const conditional = conditionalBindings.get(identifierName);
                if (conditional) {
                    const conditionalClassExpr = buildStaticConditionalClassExpression(
                        conditional,
                        effectiveFilename,
                        objectBindings,
                        source,
                        classes,
                    );
                    if (conditionalClassExpr) {
                        if (classNameAttr || szAttrs.length > 1) {
                            runtimeFallbackExpr = expression;
                            runtimeFallbackAttr = szAttr;
                            break;
                        }
                        edits.overwrite(
                            szAttr.start,
                            szAttr.end,
                            `className={${conditionalClassExpr}}`,
                        );
                        transformed = true;
                        return;
                    }
                }
            }
            if (expression.type === 'ArrayExpression') {
                const arrayClasses = astArrayToStaticClasses(
                    expression as ArrayExpressionNode,
                    effectiveFilename,
                    objectBindings,
                );
                if (arrayClasses === null) {
                    collectArrayCandidateClasses(
                        expression as ArrayExpressionNode,
                        effectiveFilename,
                        objectBindings,
                        classes,
                    );
                    runtimeFallbackExpr = expression;
                    runtimeFallbackAttr = szAttr;
                    break;
                }
                for (const c of arrayClasses) {
                    szDerived.push(c);
                    classes.add(c);
                }
                continue;
            }
            if (expression.type !== 'ObjectExpression') {
                runtimeFallbackExpr = expression;
                runtimeFallbackAttr = szAttr;
                break;
            }
            let szObj: SzObject;
            try {
                szObj = astObjectToSzObject(
                    expression as ObjectExpressionNode,
                    effectiveFilename,
                    objectBindings,
                );
            } catch (err) {
                if (err instanceof OxcNotImplementedError) {
                    const conditionalSpreadClassExpr = buildConditionalSpreadClassExpression(
                        expression as ObjectExpressionNode,
                        effectiveFilename,
                        objectBindings,
                        source,
                        classes,
                    );
                    if (conditionalSpreadClassExpr) {
                        if (classNameAttr || szAttrs.length > 1) {
                            runtimeFallbackExpr = expression;
                            runtimeFallbackAttr = szAttr;
                            break;
                        }
                        edits.overwrite(
                            szAttr.start,
                            szAttr.end,
                            `className={${conditionalSpreadClassExpr}}`,
                        );
                        transformed = true;
                        return;
                    }
                    const partial = buildPartialObjectTransform(
                        expression as ObjectExpressionNode,
                        effectiveFilename,
                        objectBindings,
                        source,
                    );
                    if (partial && szAttrs.length === 1) {
                        if (classNameAttr?.value?.type === 'JSXExpressionContainer') {
                            const classExpression = (
                                classNameAttr.value as unknown as { expression: OxcNode }
                            ).expression;
                            const classExpressionSource = source.slice(
                                classExpression.start,
                                classExpression.end,
                            );
                            edits.overwrite(
                                classNameAttr.start,
                                classNameAttr.end,
                                `className={_szMerge(${classExpressionSource}, ${JSON.stringify(partial.className)})}`,
                            );
                            edits.remove(whitespaceStart(source, szAttr.start), szAttr.end);
                            applyStyleProps(edits, source, styleAttr, lastAttr, partial.styleProps);
                            for (const c of partial.className.split(/\s+/)) {
                                if (c) {
                                    classes.add(c);
                                }
                            }
                            usesRuntime = true;
                            usesMerge = true;
                            usesColorVar ||= partial.usesColorVar;
                            transformed = true;
                            return;
                        }
                        if (classNameAttr && stringLiteralValue(classNameAttr.value) !== null) {
                            const existing = stringLiteralValue(classNameAttr.value);
                            const merged = [existing, partial.className].filter(Boolean).join(' ');
                            edits.overwrite(
                                classNameAttr.start,
                                classNameAttr.end,
                                `className="${merged}"`,
                            );
                            edits.remove(whitespaceStart(source, szAttr.start), szAttr.end);
                        } else {
                            edits.overwrite(szAttr.start, szAttr.end, partial.classNameAttr);
                        }
                        applyStyleProps(edits, source, styleAttr, lastAttr, partial.styleProps);
                        for (const c of partial.className.split(/\s+/)) {
                            if (c) {
                                classes.add(c);
                            }
                        }
                        usesColorVar ||= partial.usesColorVar;
                        transformed = true;
                        return;
                    }
                    runtimeFallbackExpr = expression;
                    runtimeFallbackAttr = szAttr;
                    break;
                }
                throw err;
            }
            const result = compileSzObject(szObj);
            for (const c of result.className.split(/\s+/)) {
                if (c) {
                    szDerived.push(c);
                    classes.add(c);
                }
            }
        }

        if (runtimeFallbackExpr && runtimeFallbackAttr) {
            // Non-static sz value → emit `className={_sz(<original-expr>)}`
            // by source-slicing the expression's original byte range. Babel
            // does the equivalent at `transform.ts:745-786` via
            // `_szMerge`/`_sz` wrappers. Existing className merging in this
            // path is deferred to a later slice — the fixtures only
            // exercise the single-sz / no-className case so far.
            if (classNameAttr) {
                throw new OxcNotImplementedError(
                    'D2.5+',
                    `runtime sz fallback combined with existing className at ${effectiveFilename}:${runtimeFallbackAttr.start}`,
                );
            }
            const exprSource = source.slice(runtimeFallbackExpr.start, runtimeFallbackExpr.end);
            if (runtimeFallbackExpr.type !== 'ArrayExpression') {
                diagnostics.push(buildRuntimeFallbackDiagnostic(runtimeFallbackExpr, source));
            }
            edits.overwrite(
                runtimeFallbackAttr.start,
                runtimeFallbackAttr.end,
                `className={_sz(${exprSource})}`,
            );
            // Delete any remaining sz attributes (rare — typically only
            // one sz per element).
            for (const szAttr of szAttrs) {
                if (szAttr === runtimeFallbackAttr) continue;
                const deleteStart = whitespaceStart(source, szAttr.start);
                edits.remove(deleteStart, szAttr.end);
            }
            usesRuntime = true;
            transformed = true;
            return;
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
        usesRuntime,
        usesMerge,
        usesColorVar,
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

/**
 * Convert a byte offset into a 1-based line + 0-based column pair,
 * matching the signature of `generateInlineRecoveryToken`. Babel
 * exposes `node.loc.start.{line,column}` for free; oxc-parser only
 * gives offsets, so we count newlines on the fly.
 *
 * @param source The full source string.
 * @param offset Zero-based byte offset.
 * @returns 1-based line, 0-based column.
 */
function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
    let line = 1;
    let column = 0;
    const limit = Math.min(offset, source.length);
    for (let i = 0; i < limit; i++) {
        if (source.charCodeAt(i) === 10) {
            line++;
            column = 0;
        } else {
            column++;
        }
    }
    return { line, column };
}

/**
 * Build the same dev diagnostic Babel emits when sz falls back to runtime.
 *
 * @param expression Runtime fallback expression.
 * @param source Original source.
 * @returns Diagnostic string.
 */
function buildRuntimeFallbackDiagnostic(expression: OxcNode, source: string): string {
    const { line, column } = offsetToLineColumn(source, expression.start);
    const lineCol = `${line}:${column + 1}`;
    let reason: string;
    let suggestion: string;
    if (expression.type === 'CallExpression') {
        const callee = (expression as CallExpressionNode).callee;
        const name =
            callee.type === 'Identifier'
                ? (callee as IdentifierNode).name
                : callee.type === 'MemberExpression' &&
                    ((callee as unknown as { property?: OxcNode }).property?.type ?? '') ===
                        'Identifier'
                  ? String(
                        ((callee as unknown as { property: OxcNode }).property as IdentifierNode)
                            .name,
                    )
                  : '?';
        reason = `function call \`${name}()\` result is unknown at build time`;
        suggestion =
            'If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic().';
    } else if (expression.type === 'Identifier') {
        reason = `identifier \`${(expression as IdentifierNode).name}\` could not be resolved to a static value`;
        suggestion =
            "Make sure it's a module-level or function-body const with a literal object value. For variant-based styling → szv(). For true runtime values → dynamic().";
    } else if (expression.type === 'MemberExpression') {
        reason = 'member expression is not statically resolvable';
        suggestion =
            'Extract the value to a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().';
    } else {
        reason = `expression of type \`${expression.type}\` is not statically analyzable`;
        suggestion =
            'Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().';
    }
    return `sz fallback at ${lineCol}: ${reason}.\n  Suggestion: ${suggestion}`;
}

/**
 * Extract the element name from a JSXOpeningElement's `name` field.
 * Mirrors the fallback chain used at `transform.ts:191-195`:
 *   JSXIdentifier → its name; JSXMemberExpression → `<member>`;
 *   anything else → `<unknown>`.
 *
 * @param nameNode The opening element's `name` AST node.
 * @returns Display name used in the recovery-token hash input.
 */
function extractElementName(nameNode: OxcNode): string {
    if (nameNode.type === 'JSXIdentifier') {
        return String((nameNode as unknown as { name: string }).name);
    }
    if (nameNode.type === 'JSXMemberExpression') {
        return '<member>';
    }
    return '<unknown>';
}

/** Minimum surface of an oxc AST node we rely on in this file. */
interface OxcNode {
    type: string;
    start: number;
    end: number;
    [key: string]: unknown;
}

/** oxc shape for an identifier expression or binding. */
interface IdentifierNode extends OxcNode {
    type: 'Identifier';
    name: string;
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
    name: OxcNode;
    attributes: OxcNode[];
    selfClosing: boolean;
}

/** oxc shape for an object literal expression (`{ p: 4 }`). */
interface ObjectExpressionNode extends OxcNode {
    type: 'ObjectExpression';
    properties: OxcNode[];
}

/** oxc shape for an array literal expression (`[{ p: 4 }, false]`). */
interface ArrayExpressionNode extends OxcNode {
    type: 'ArrayExpression';
    elements: Array<OxcNode | null>;
}

/** oxc shape for a ternary expression (`cond ? a : b`). */
interface ConditionalExpressionNode extends OxcNode {
    type: 'ConditionalExpression';
    test: OxcNode;
    consequent: OxcNode;
    alternate: OxcNode;
}

/** oxc shape for a call expression (`dynamic({...})`). */
interface CallExpressionNode extends OxcNode {
    type: 'CallExpression';
    callee: OxcNode;
    arguments: OxcNode[];
}

/** oxc shape for a logical expression (`cond && expr`). */
interface LogicalExpressionNode extends OxcNode {
    type: 'LogicalExpression';
    operator: string;
    left: OxcNode;
    right: OxcNode;
}

/** oxc shape for a single property inside an ObjectExpression. */
interface PropertyNode extends OxcNode {
    type: 'Property';
    key: OxcNode;
    value: OxcNode;
    computed: boolean;
    shorthand: boolean;
}

/** oxc shape for object spread (`{ ...base }`). */
interface SpreadElementNode extends OxcNode {
    type: 'SpreadElement';
    argument: OxcNode;
}

/** Dynamic CSS variable info produced by partial sz object analysis. */
interface OxcDynamicPropInfo {
    expression: OxcNode;
    category: PropertyCategory;
    varName: string;
    twPrefix: string;
    variantChain: string;
}

/** Conditional static class entry for a single property ternary. */
interface OxcConditionalClassEntry {
    test: OxcNode;
    consequent: string;
    alternate: string;
}

/** Result of partially evaluating an oxc object expression. */
interface OxcPartialObjectResult {
    staticProps: SzObject;
    dynamicProps: Map<string, OxcDynamicPropInfo>;
    conditionalClasses: OxcConditionalClassEntry[];
    usesColorVar: boolean;
}

/** Ready-to-emit partial object transform fragments. */
interface OxcPartialTransform {
    className: string;
    classNameAttr: string;
    styleProps: string[];
    usesColorVar: boolean;
}

/**
 * Convert an oxc `ObjectExpression` AST node into a plain {@link SzObject}
 * the browser-pure `transform()` helper can consume. Throws
 * {@link OxcNotImplementedError} on any pattern D2.1 does not handle
 * (identifiers, spreads, ternaries, template literals, methods).
 *
 * @param node The oxc ObjectExpression node.
 * @param filename Filename for diagnostic offsets.
 * @param bindings Local object-literal bindings available for spread resolution.
 * @returns Plain JS object with literal values.
 */
function astObjectToSzObject(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
): SzObject {
    const result: Record<string, SzValue> = {};
    for (const propRaw of node.properties) {
        if (propRaw.type === 'SpreadElement') {
            const spread = propRaw as SpreadElementNode;
            if (spread.argument.type === 'Identifier') {
                const bound = bindings.get(String((spread.argument as IdentifierNode).name));
                if (bound) {
                    Object.assign(result, astObjectToSzObject(bound, filename, bindings));
                    continue;
                }
            }
            throw new OxcNotImplementedError(
                'D5',
                `unsupported object spread in sz object at ${filename}:${propRaw.start}`,
            );
        }
        if (propRaw.type !== 'Property') {
            throw new OxcNotImplementedError(
                'D5',
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
        result[key] = astValueToSzValue(prop.value, filename, bindings);
    }
    return result as SzObject;
}

/**
 * Compile a fully-static sz array into class tokens.
 *
 * Mirrors Babel's no-runtime fast path for arrays containing only object
 * literals and falsy literal placeholders. Conditional/logical elements
 * intentionally return null so a later slice can emit `_szMerge(...)`.
 *
 * @param node The oxc ArrayExpression node.
 * @param filename Filename for diagnostic offsets.
 * @param bindings Local object-literal bindings available for identifier/spread resolution.
 * @returns Static class tokens, or null when runtime handling is required.
 */
function astArrayToStaticClasses(
    node: ArrayExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
): string[] | null {
    const out: string[] = [];
    for (const element of node.elements) {
        if (!element || isFalsyLiteral(element)) {
            continue;
        }
        let objectNode: ObjectExpressionNode | null = null;
        if (element.type === 'ObjectExpression') {
            objectNode = element as ObjectExpressionNode;
        } else if (element.type === 'Identifier') {
            objectNode = bindings.get(String((element as IdentifierNode).name)) ?? null;
        }
        if (!objectNode) {
            return null;
        }
        let result: ReturnType<typeof compileSzObject>;
        try {
            result = compileSzObject(astObjectToSzObject(objectNode, filename, bindings));
        } catch (err) {
            if (err instanceof OxcNotImplementedError) {
                return null;
            }
            throw err;
        }
        for (const c of result.className.split(/\s+/)) {
            if (c) {
                out.push(c);
            }
        }
    }
    return out;
}

/**
 * Collect statically visible classes from an array that still needs runtime fallback.
 *
 * @param node Array expression used as the sz value.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param classes Class set to populate.
 */
function collectArrayCandidateClasses(
    node: ArrayExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    classes: Set<string>,
): void {
    for (const element of node.elements) {
        if (!element || isFalsyLiteral(element)) {
            continue;
        }
        const candidate =
            element.type === 'LogicalExpression' &&
            (element as LogicalExpressionNode).operator === '&&'
                ? (element as LogicalExpressionNode).right
                : element;
        collectStaticObjectCandidateClasses(candidate, filename, bindings, classes);
    }
}

/**
 * Collect classes from a statically resolvable object candidate.
 *
 * @param node Candidate node.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param classes Class set to populate.
 */
function collectStaticObjectCandidateClasses(
    node: OxcNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    classes: Set<string>,
): void {
    const objectNode = resolveObjectExpression(node, bindings);
    if (!objectNode) {
        return;
    }
    let result: ReturnType<typeof compileSzObject>;
    try {
        result = compileSzObject(astObjectToSzObject(objectNode, filename, bindings));
    } catch (err) {
        if (err instanceof OxcNotImplementedError) {
            return;
        }
        throw err;
    }
    for (const cls of result.className.split(/\s+/)) {
        if (cls) {
            classes.add(cls);
        }
    }
}

/**
 * Checks array placeholders that Babel treats as static no-ops.
 *
 * @param node Array element node.
 * @returns True for `false` and `null` literals.
 */
function isFalsyLiteral(node: OxcNode): boolean {
    if (node.type !== 'Literal') {
        return false;
    }
    const value = (node as unknown as { value: unknown }).value;
    return value === false || value === null;
}

/**
 * Enforce the same per-file traversal budget as the Babel transform.
 *
 * @param root Parsed program root.
 * @param filename Source filename for diagnostics.
 * @param astBudget Maximum node count.
 */
function assertAstBudget(root: OxcNode, filename: string, astBudget: number): void {
    let nodeCount = 0;
    walk(root, () => {
        nodeCount++;
        if (nodeCount > astBudget) {
            throw new ASTBudgetExceededError(filename, nodeCount, astBudget);
        }
    });
}

/**
 * Collect classes from static `dynamic({...})` calls without rewriting source.
 *
 * @param node Call expression to inspect.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param classes Class set to populate.
 */
function collectDynamicCallClasses(
    node: CallExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    classes: Set<string>,
): void {
    if (node.callee.type !== 'Identifier' || (node.callee as IdentifierNode).name !== 'dynamic') {
        return;
    }
    const [firstArg] = node.arguments;
    if (!firstArg) {
        return;
    }
    const objectNode = resolveObjectExpression(firstArg, bindings);
    if (!objectNode) {
        return;
    }
    let result: ReturnType<typeof compileSzObject>;
    try {
        result = compileSzObject(astObjectToSzObject(objectNode, filename, bindings));
    } catch (err) {
        if (err instanceof OxcNotImplementedError) {
            return;
        }
        throw err;
    }
    for (const cls of result.className.split(/\s+/)) {
        if (cls) {
            classes.add(cls);
        }
    }
}

/**
 * Resolve an expression to a local object literal when possible.
 *
 * @param node Candidate expression.
 * @param bindings Local object-literal bindings.
 * @returns Object expression, or null.
 */
function resolveObjectExpression(
    node: OxcNode,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
): ObjectExpressionNode | null {
    const unwrapped = unwrapExpression(node);
    if (unwrapped.type === 'ObjectExpression') {
        return unwrapped as ObjectExpressionNode;
    }
    if (unwrapped.type === 'Identifier') {
        return bindings.get(String((unwrapped as IdentifierNode).name)) ?? null;
    }
    return null;
}

/**
 * Build a className ternary for `{ ...(cond ? a : b), static: true }`.
 *
 * @param node Object expression used as the sz value.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param source Original source for test expression slicing.
 * @param classes Class set to populate.
 * @returns Ternary className expression source, or null when unsupported.
 */
function buildConditionalSpreadClassExpression(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
    classes: Set<string>,
): string | null {
    let conditionalSpread: ConditionalExpressionNode | null = null;
    const otherProps: OxcNode[] = [];
    for (const prop of node.properties) {
        if (prop.type !== 'SpreadElement') {
            otherProps.push(prop);
            continue;
        }
        const spread = prop as SpreadElementNode;
        const spreadArgument = unwrapExpression(spread.argument);
        if (spreadArgument.type !== 'ConditionalExpression' || conditionalSpread) {
            return null;
        }
        conditionalSpread = spreadArgument as ConditionalExpressionNode;
    }
    if (!conditionalSpread) {
        return null;
    }

    const consequent = compileConditionalSpreadBranch(
        conditionalSpread.consequent,
        otherProps,
        node,
        filename,
        bindings,
    );
    const alternate = compileConditionalSpreadBranch(
        conditionalSpread.alternate,
        otherProps,
        node,
        filename,
        bindings,
    );
    if (consequent === null || alternate === null) {
        return null;
    }
    for (const cls of `${consequent} ${alternate}`.split(/\s+/)) {
        if (cls) {
            classes.add(cls);
        }
    }
    const testSource = source.slice(conditionalSpread.test.start, conditionalSpread.test.end);
    return `${testSource} ? ${JSON.stringify(consequent)} : ${JSON.stringify(alternate)}`;
}

/**
 * Compile one branch of a conditional object spread plus the static overrides.
 *
 * @param branch Conditional branch expression.
 * @param otherProps Static properties outside the spread.
 * @param sourceNode Source object node used for span fields.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @returns Compiled class string, or null when unsupported.
 */
function compileConditionalSpreadBranch(
    branch: OxcNode,
    otherProps: OxcNode[],
    sourceNode: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
): string | null {
    const branchObject = resolveObjectExpression(branch, bindings);
    if (!branchObject) {
        return null;
    }
    try {
        const branchValue = astObjectToSzObject(branchObject, filename, bindings);
        const overrides = astObjectToSzObject(
            { ...sourceNode, properties: otherProps },
            filename,
            bindings,
        );
        return compileSzObject({ ...branchValue, ...overrides }).className;
    } catch (err) {
        if (err instanceof OxcNotImplementedError) {
            return null;
        }
        throw err;
    }
}

/**
 * Build className/style fragments for a sz object with static and dynamic values.
 *
 * @param node Object expression used as the sz value.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param source Original source for preserving runtime expressions.
 * @returns Transform fragments, or null when the object needs runtime fallback.
 */
function buildPartialObjectTransform(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
): OxcPartialTransform | null {
    const partial = evaluatePartialObject(node, filename, bindings, source);
    if (!partial || (partial.dynamicProps.size === 0 && partial.conditionalClasses.length === 0)) {
        return null;
    }
    if (
        partial.conditionalClasses.length > 0 &&
        (partial.conditionalClasses.length !== 1 ||
            partial.dynamicProps.size > 0 ||
            Object.keys(partial.staticProps).length > 0)
    ) {
        return null;
    }

    const classParts: string[] = [];
    if (Object.keys(partial.staticProps).length > 0) {
        const { className } = compileSzObject(partial.staticProps);
        if (className) {
            classParts.push(className);
        }
    }

    for (const [, info] of partial.dynamicProps) {
        classParts.push(buildCSSVarClassName(info));
    }
    for (const entry of partial.conditionalClasses) {
        classParts.push(entry.consequent, entry.alternate);
    }

    const className = classParts.filter(Boolean).join(' ');
    const classNameAttr =
        partial.conditionalClasses.length > 0
            ? `className={${buildConditionalClassSource(classParts, partial.conditionalClasses, source)}}`
            : `className="${className}"`;
    const styleProps = [...partial.dynamicProps.values()].map(
        info => `${JSON.stringify(info.varName)}: ${generateStyleValueSource(info, source)}`,
    );
    return { className, classNameAttr, styleProps, usesColorVar: partial.usesColorVar };
}

/**
 * Partially evaluate an object expression into static props and CSS-variable props.
 *
 * @param node Object expression to evaluate.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param source Original source for preserving runtime expressions.
 * @param variantChain Current nested variant chain.
 * @returns Partial object result, or null for unsupported spread/computed cases.
 */
function evaluatePartialObject(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
    variantChain = '',
): OxcPartialObjectResult | null {
    const staticProps: SzObject = {};
    const dynamicProps = new Map<string, OxcDynamicPropInfo>();
    const conditionalClasses: OxcConditionalClassEntry[] = [];
    let usesColorVar = false;

    for (const propRaw of node.properties) {
        if (propRaw.type === 'SpreadElement') {
            const spread = propRaw as SpreadElementNode;
            const objectNode = resolveObjectExpression(spread.argument, bindings);
            if (!objectNode) {
                return null;
            }
            try {
                Object.assign(staticProps, astObjectToSzObject(objectNode, filename, bindings));
                continue;
            } catch (err) {
                if (err instanceof OxcNotImplementedError) {
                    return null;
                }
                throw err;
            }
        }
        if (propRaw.type !== 'Property') {
            return null;
        }
        const prop = propRaw as PropertyNode;
        if (prop.computed) {
            return null;
        }
        const key = extractKeyName(prop.key);
        if (key === null) {
            return null;
        }

        const value = unwrapExpression(prop.value);
        try {
            if (value.type === 'ObjectExpression') {
                staticProps[key] = astObjectToSzObject(
                    value as ObjectExpressionNode,
                    filename,
                    bindings,
                );
                continue;
            }
            staticProps[key] = astValueToSzValue(value, filename, bindings);
            continue;
        } catch (err) {
            if (!(err instanceof OxcNotImplementedError)) {
                throw err;
            }
        }

        if (value.type === 'ObjectExpression' && isKnownVariant(key)) {
            const nestedVariant = variantChain ? `${variantChain}-${key}` : key;
            const nested = evaluatePartialObject(
                value as ObjectExpressionNode,
                filename,
                bindings,
                source,
                nestedVariant,
            );
            if (!nested) {
                return null;
            }
            if (Object.keys(nested.staticProps).length > 0) {
                staticProps[key] = nested.staticProps;
            }
            for (const [nestedKey, nestedInfo] of nested.dynamicProps) {
                dynamicProps.set(nestedKey, nestedInfo);
            }
            conditionalClasses.push(...nested.conditionalClasses);
            usesColorVar ||= nested.usesColorVar;
            continue;
        }

        if (value.type === 'ConditionalExpression') {
            const conditional = value as ConditionalExpressionNode;
            const consequent = extractStaticLiteralValue(conditional.consequent);
            const alternate = extractStaticLiteralValue(conditional.alternate);
            if (consequent !== null && alternate !== null) {
                const { className: consequentClasses } = compileSzObject({ [key]: consequent });
                const { className: alternateClasses } = compileSzObject({ [key]: alternate });
                conditionalClasses.push({
                    test: conditional.test,
                    consequent: prefixVariantClasses(consequentClasses, variantChain),
                    alternate: prefixVariantClasses(alternateClasses, variantChain),
                });
                continue;
            }
        }

        if (!isRuntimeExpression(value)) {
            return null;
        }

        const twPrefix =
            PROPERTY_MAP[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        const category = getPropertyCategory(key);
        const varName = getCSSVariableName(key, variantChain || undefined);
        const uniqueKey = variantChain ? `${variantChain}-${key}` : key;
        if (COLOR_PROPERTIES.has(key)) {
            usesColorVar = true;
        }
        dynamicProps.set(uniqueKey, {
            expression: value,
            category,
            varName,
            twPrefix,
            variantChain,
        });
    }

    return { staticProps, dynamicProps, conditionalClasses, usesColorVar };
}

/**
 * Add or merge style props generated by CSS-variable auto-compile.
 *
 * @param edits MagicString instance to update.
 * @param source Original source.
 * @param styleAttr Existing style attribute, if any.
 * @param lastAttr Last JSX attribute in the opening element.
 * @param styleProps Object property source fragments.
 */
function applyStyleProps(
    edits: MagicString,
    source: string,
    styleAttr: JsxAttributeNode | null,
    lastAttr: JsxAttributeNode | null,
    styleProps: string[],
): void {
    if (styleProps.length === 0) {
        return;
    }
    const propsSource = styleProps.join(', ');
    if (!styleAttr) {
        if (lastAttr) {
            edits.appendRight(lastAttr.end, ` style={{${propsSource}}}`);
        }
        return;
    }
    if (styleAttr.value?.type !== 'JSXExpressionContainer') {
        return;
    }
    const expression = (styleAttr.value as unknown as { expression: OxcNode }).expression;
    const styleSource = source.slice(expression.start, expression.end);
    edits.overwrite(styleAttr.start, styleAttr.end, `style={{...${styleSource}, ${propsSource}}}`);
}

/**
 * Generate a style value expression source for a dynamic CSS variable.
 *
 * @param info Dynamic prop metadata.
 * @param source Original source for expression slicing.
 * @returns JavaScript expression source.
 */
function generateStyleValueSource(info: OxcDynamicPropInfo, source: string): string {
    const expressionSource = source.slice(info.expression.start, info.expression.end);
    switch (info.category) {
        case PropertyCategory.SPACING:
            return `\`calc(\${${expressionSource}} * var(--spacing))\``;
        case PropertyCategory.COLOR:
            return `__szColorVar(${expressionSource})`;
        case PropertyCategory.ANGLE:
            return `\`\${${expressionSource}}deg\``;
        case PropertyCategory.DURATION:
            return `\`\${${expressionSource}}ms\``;
        default:
            return `\`\${${expressionSource}}\``;
    }
}

/**
 * Build Tailwind's CSS variable shorthand class for a dynamic property.
 *
 * @param info Dynamic prop metadata.
 * @returns Class name such as `p-(--_sz-p)`.
 */
function buildCSSVarClassName(info: OxcDynamicPropInfo): string {
    const variantPrefix = info.variantChain ? `${getVariantPrefix(info.variantChain)}:` : '';
    return `${variantPrefix}${info.twPrefix}-(${info.varName})`;
}

/**
 * Build the className expression when static property ternaries are present.
 *
 * @param classParts All class names for extraction.
 * @param conditionals Conditional class entries.
 * @param source Original source for test expression slicing.
 * @returns JavaScript expression source.
 */
function buildConditionalClassSource(
    classParts: string[],
    conditionals: OxcConditionalClassEntry[],
    source: string,
): string {
    if (conditionals.length === 1 && classParts.length === 2) {
        const [entry] = conditionals;
        return `${source.slice(entry.test.start, entry.test.end)} ? ${JSON.stringify(entry.consequent)} : ${JSON.stringify(entry.alternate)}`;
    }
    return JSON.stringify(classParts.filter(Boolean).join(' '));
}

/**
 * Extract a primitive static literal for conditional property branches.
 *
 * @param node Candidate expression.
 * @returns Literal value, or null when dynamic.
 */
function extractStaticLiteralValue(node: OxcNode): string | number | boolean | null {
    const unwrapped = unwrapExpression(node);
    if (unwrapped.type !== 'Literal') {
        return null;
    }
    const value = (unwrapped as unknown as { value: unknown }).value;
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : null;
}

/**
 * Check whether a property key is a known variant container.
 *
 * @param key sz object key.
 * @returns True for known variants.
 */
function isKnownVariant(key: string): boolean {
    return KNOWN_VARIANTS.has(key) || KNOWN_VARIANTS.has(getVariantPrefix(key));
}

/**
 * Prefix static classes with the current variant chain.
 *
 * @param className Space-separated class list.
 * @param variantChain Current variant chain.
 * @returns Prefixed classes.
 */
function prefixVariantClasses(className: string, variantChain: string): string {
    if (!variantChain) {
        return className;
    }
    const prefix = `${getVariantPrefix(variantChain)}:`;
    return className
        .split(/\s+/)
        .filter(Boolean)
        .map(cls => `${prefix}${cls}`)
        .join(' ');
}

/**
 * Check whether an oxc node can safely be preserved as a runtime style expression.
 *
 * @param node Candidate node.
 * @returns True when source slicing can produce an expression.
 */
function isRuntimeExpression(node: OxcNode): boolean {
    return (
        node.type === 'Identifier' ||
        node.type === 'MemberExpression' ||
        node.type === 'CallExpression' ||
        node.type === 'ConditionalExpression' ||
        node.type === 'TemplateLiteral' ||
        node.type === 'BinaryExpression' ||
        node.type === 'LogicalExpression'
    );
}

/**
 * Build a className ternary from statically resolvable sz branches.
 *
 * @param node Conditional expression used as the sz value.
 * @param filename Filename for diagnostic offsets.
 * @param bindings Local object-literal bindings available for branch resolution.
 * @param source Original source for slicing the test expression.
 * @param classes Class set to populate for Tailwind/mangle discovery.
 * @returns Source for a className expression, or null when a branch is dynamic.
 */
function buildStaticConditionalClassExpression(
    node: ConditionalExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
    classes: Set<string>,
): string | null {
    const consequent = resolveStaticClassString(node.consequent, filename, bindings);
    const alternate = resolveStaticClassString(node.alternate, filename, bindings);
    if (consequent === null || alternate === null) {
        return null;
    }
    for (const cls of `${consequent} ${alternate}`.split(/\s+/)) {
        if (cls) {
            classes.add(cls);
        }
    }
    const testSource = source.slice(node.test.start, node.test.end);
    return `${testSource} ? ${JSON.stringify(consequent)} : ${JSON.stringify(alternate)}`;
}

/**
 * Resolve an expression that Babel's tryStaticTransformNode can turn into a class string.
 *
 * @param node Candidate expression.
 * @param filename Filename for diagnostic offsets.
 * @param bindings Local object-literal bindings.
 * @returns Compiled class string, or null when dynamic.
 */
function resolveStaticClassString(
    node: OxcNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
): string | null {
    const unwrapped = unwrapExpression(node);
    let objectNode: ObjectExpressionNode | null = null;
    if (unwrapped.type === 'ObjectExpression') {
        objectNode = unwrapped as ObjectExpressionNode;
    } else if (unwrapped.type === 'Identifier') {
        objectNode = bindings.get(String((unwrapped as IdentifierNode).name)) ?? null;
    }
    if (!objectNode) {
        return null;
    }
    try {
        return compileSzObject(astObjectToSzObject(objectNode, filename, bindings)).className;
    } catch (err) {
        if (err instanceof OxcNotImplementedError) {
            return null;
        }
        throw err;
    }
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
 * @param bindings Local object-literal bindings available for nested spread resolution.
 * @returns Plain JS value usable by `transform()`.
 */
function astValueToSzValue(
    node: OxcNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
): SzValue {
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
        return astObjectToSzObject(node as ObjectExpressionNode, filename, bindings);
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
 * Collect local object-literal bindings for the minimal D5 scope surface.
 *
 * This intentionally captures only direct variable declarators whose init
 * unwraps to an object expression. It is enough for common `const base = {}`
 * patterns while avoiding import/call/computed cases that need fuller scope
 * semantics.
 *
 * @param root Program AST root.
 * @returns Identifier name to object-expression initializer.
 */
function collectObjectBindings(root: OxcNode): Map<string, ObjectExpressionNode> {
    const bindings = new Map<string, ObjectExpressionNode>();
    walk(root, node => {
        if (node.type !== 'VariableDeclarator') {
            return;
        }
        const id = (node as unknown as { id?: OxcNode }).id;
        const init = (node as unknown as { init?: OxcNode | null }).init;
        if (!id || id.type !== 'Identifier' || !init) {
            return;
        }
        const unwrapped = unwrapExpression(init);
        if (unwrapped.type === 'ObjectExpression') {
            bindings.set(String((id as IdentifierNode).name), unwrapped as ObjectExpressionNode);
        }
    });
    return bindings;
}

/**
 * Collect local bindings initialized to conditional expressions.
 *
 * @param root Program root.
 * @returns Map from local identifier to conditional initializer.
 */
function collectConditionalBindings(root: OxcNode): Map<string, ConditionalExpressionNode> {
    const bindings = new Map<string, ConditionalExpressionNode>();
    walk(root, node => {
        if (node.type !== 'VariableDeclarator') {
            return;
        }
        const id = (node as unknown as { id?: OxcNode }).id;
        const init = (node as unknown as { init?: OxcNode | null }).init;
        if (!id || id.type !== 'Identifier' || !init) {
            return;
        }
        const unwrapped = unwrapExpression(init);
        if (unwrapped.type === 'ConditionalExpression') {
            bindings.set(
                String((id as IdentifierNode).name),
                unwrapped as ConditionalExpressionNode,
            );
        }
    });
    return bindings;
}

/**
 * Remove TypeScript wrappers around expression initializers.
 *
 * @param node Expression node.
 * @returns Inner runtime expression node.
 */
function unwrapExpression(node: OxcNode): OxcNode {
    let current = node;
    while (
        current.type === 'TSAsExpression' ||
        current.type === 'TSSatisfiesExpression' ||
        current.type === 'TSNonNullExpression' ||
        current.type === 'ParenthesizedExpression'
    ) {
        const next = (current as unknown as { expression?: OxcNode }).expression;
        if (!next) {
            break;
        }
        current = next;
    }
    return current;
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
