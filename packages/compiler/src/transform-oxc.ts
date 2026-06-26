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
import {
    type CSSVariableHoistDiagnostic,
    type CSSVariableHoistNode,
    type CSSVariableHoistUsage,
    planComponentVariableHoistsWithDiagnostics,
} from './css-var-hoist-planner.js';
import { planCSSVariableNames } from './css-var-planner.js';
import type { TokenData } from './manifest.js';
import {
    COLOR_PROPERTIES,
    getCSSVariableName,
    getPropertyCategory,
    PropertyCategory,
} from './property-types.js';
import { generateInlineRecoveryToken, isValidInlineRecoveryMode } from './recovery-tokens.js';
import type {
    CssVariableMangleValue,
    SourceTransformResult,
    TransformSourceCodeOptions,
} from './transform.js';
import {
    transform as compileSzObject,
    formatSzWarnLocation,
    getVariantPrefix,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    type SzObject,
    type SzValue,
    setSzWarnLocation,
} from './transform-core.js';

/** Result shape returned by the oxc parser path. */
export type TransformOxcResult = SourceTransformResult;

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
    const cssVariableMap = new Map<string, CssVariableMangleValue>();
    const globalVarAliases = normalizeGlobalVarAliases(options?.globalVarAliases);

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
            cssVariableMap,
        };
    }

    const effectiveFilename = filename ?? 'file.tsx';
    // Defensively clear any location a previous transform left set after an early
    // return, so a runtime/browser warning never inherits a stale build location.
    setSzWarnLocation(undefined);
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
    // szv config resolution follows ONLY `const` bindings (a reassigned `let`
    // would be unsound), so it uses a const-only map distinct from the general
    // sz-object resolution above which keeps all binding kinds.
    const constObjectBindings = collectObjectBindings(parsed.program as unknown as OxcNode, true);
    const conditionalBindings = collectConditionalBindings(parsed.program as unknown as OxcNode);
    const reservedCSSVariableNames = options?.mangleVars
        ? collectStaticStyleCustomPropertyNames(parsed.program as unknown as OxcNode)
        : undefined;
    const componentHoists = options?.mangleVars
        ? planOxcComponentVariableHoists(
              parsed.program as unknown as OxcNode,
              effectiveFilename,
              objectBindings,
              source,
              options.mangleVarHoistMaxDepth,
              reservedCSSVariableNames,
          )
        : null;
    if (componentHoists) {
        diagnostics.push(...componentHoists.diagnostics);
    }
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
            collectSzvCallClasses(
                node as CallExpressionNode,
                effectiveFilename,
                constObjectBindings,
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
        let appliedHoistedStyleProps = false;
        const elementId = elementIdForOpening(openingNode);
        const hoistedStyleProps = componentHoists?.stylePropsByTarget.get(elementId) ?? [];
        const applyHoistedStyleProps = (): void => {
            if (appliedHoistedStyleProps || hoistedStyleProps.length === 0) {
                return;
            }
            applyStyleProps(
                edits,
                source,
                styleAttr,
                lastAttr,
                hoistedStyleProps,
                openingNode.name.end,
            );
            appliedHoistedStyleProps = true;
            transformed = true;
        };

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
            applyHoistedStyleProps();
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
            // Point the dev-mode unknown-property warning at this sz prop. All
            // lowering for this attribute (and nested objects) runs synchronously
            // below, so the location is correct until the next attribute or the
            // post-loop clear.
            const { line: szWarnLine } = offsetToLineColumn(source, szAttr.start);
            setSzWarnLocation(
                formatSzWarnLocation(effectiveFilename, szWarnLine, options?.rootDir),
            );
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
                    globalVarAliases,
                    cssVariableMap,
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
                        applyGlobalVarAliasesToSzObject(
                            astObjectToSzObject(bound, effectiveFilename, objectBindings),
                            globalVarAliases,
                            cssVariableMap,
                        ),
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
                        globalVarAliases,
                        cssVariableMap,
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
                const arrayMergeExpression = buildArrayMergeExpression(
                    expression as ArrayExpressionNode,
                    effectiveFilename,
                    objectBindings,
                    globalVarAliases,
                    cssVariableMap,
                    source,
                    classes,
                );
                if (arrayMergeExpression) {
                    const existingExpression = classNameAttr
                        ? classNameMergeArgument(classNameAttr, source)
                        : null;
                    const mergeExpression = existingExpression
                        ? `_szMerge(${existingExpression}, ${arrayMergeExpression})`
                        : `_szMerge(${arrayMergeExpression})`;
                    if (classNameAttr) {
                        edits.overwrite(
                            classNameAttr.start,
                            classNameAttr.end,
                            `className={${mergeExpression}}`,
                        );
                        edits.remove(whitespaceStart(source, szAttr.start), szAttr.end);
                    } else {
                        edits.overwrite(szAttr.start, szAttr.end, `className={${mergeExpression}}`);
                    }
                    usesRuntime = true;
                    usesMerge = true;
                    transformed = true;
                    return;
                }
                const arrayClasses = astArrayToStaticClasses(
                    expression as ArrayExpressionNode,
                    effectiveFilename,
                    objectBindings,
                    globalVarAliases,
                    cssVariableMap,
                );
                if (arrayClasses === null) {
                    collectArrayCandidateClasses(
                        expression as ArrayExpressionNode,
                        effectiveFilename,
                        objectBindings,
                        classes,
                        '',
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
                        globalVarAliases,
                        cssVariableMap,
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
                        options,
                        componentHoists?.usageNamesByElement.get(elementId),
                        cssVariableMap,
                        reservedCSSVariableNames,
                        globalVarAliases,
                    );
                    // A conditional partial beside an existing className would
                    // inline both branches into the merge, so that combination
                    // stays on the runtime fallback below.
                    if (
                        partial &&
                        szAttrs.length === 1 &&
                        !(partial.hasConditional && classNameAttr)
                    ) {
                        const mergedStyleProps =
                            hoistedStyleProps.length > 0
                                ? [...hoistedStyleProps, ...partial.styleProps]
                                : partial.styleProps;
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
                            applyStyleProps(
                                edits,
                                source,
                                styleAttr,
                                lastAttr,
                                mergedStyleProps,
                                openingNode.name.end,
                            );
                            appliedHoistedStyleProps = true;
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
                        applyStyleProps(
                            edits,
                            source,
                            styleAttr,
                            lastAttr,
                            mergedStyleProps,
                            openingNode.name.end,
                        );
                        appliedHoistedStyleProps = true;
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
            const result = compileSzObject(
                applyGlobalVarAliasesToSzObject(szObj, globalVarAliases, cssVariableMap),
            );
            for (const c of result.className.split(/\s+/)) {
                if (c) {
                    szDerived.push(c);
                    classes.add(c);
                }
            }
        }
        // Done lowering this element's sz attributes — drop the location so an
        // unrelated later transform (or the runtime path) doesn't inherit it.
        setSzWarnLocation(undefined);

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
            // A top-level object spread can't be resolved at build time and may
            // produce no styles in production — surface it with a marker the
            // bundler plugin promotes to a build-log warning (matches the rust
            // engine). Other fallback shapes stay quiet.
            if (
                runtimeFallbackExpr.type === 'ObjectExpression' &&
                (runtimeFallbackExpr as ObjectExpressionNode).properties.some(
                    prop => prop.type === 'SpreadElement',
                )
            ) {
                const { line, column } = offsetToLineColumn(source, runtimeFallbackExpr.start);
                diagnostics.push(
                    `[csszyx] unresolvable sz spread at ${line}:${column + 1}: ` +
                        'sz={{ ...x }} cannot be resolved at build time and falls back to runtime; ' +
                        'it may render no styles in production. Use array form: sz={[x, { ... }]}.',
                );
            }
            collectCandidateClassesFromExpression(
                runtimeFallbackExpr,
                effectiveFilename,
                objectBindings,
                classes,
                '',
            );
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

        applyHoistedStyleProps();

        // Merge classes: existing className value first, then sz-derived.
        // This matches the order Babel produces in `transform.ts:228-371`.
        const existingRaw = classNameAttr ? stringLiteralValue(classNameAttr.value) : null;
        const mergedClasses = [
            ...(existingRaw ? existingRaw.split(/\s+/).filter(Boolean) : []),
            ...szDerived,
        ];
        // An sz that lowers to zero classes (and has no className to merge into)
        // emits `className={undefined}` so the DOM has no `class` attribute,
        // instead of the noisy `class=""`.
        const mergedAttr =
            mergedClasses.length === 0
                ? 'className={undefined}'
                : `className="${mergedClasses.join(' ')}"`;

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
        cssVariableMap,
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

/** oxc shape for a JSX element with an opening tag and children. */
interface JsxElementNode extends OxcNode {
    type: 'JSXElement';
    openingElement: JsxOpeningElementNode;
    children: OxcNode[];
}

/** oxc shape for a JSX fragment. */
interface JsxFragmentNode extends OxcNode {
    type: 'JSXFragment';
    children: OxcNode[];
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
    /** True when the emitted attribute embeds a runtime conditional branch. */
    hasConditional: boolean;
}

/** Hoist decisions indexed for the source rewrite pass. */
interface OxcComponentHoistAnalysis {
    stylePropsByTarget: Map<string, string[]>;
    usageNamesByElement: Map<string, Map<string, string>>;
    diagnostics: string[];
}

/** Candidate dynamic var found during the read-only hoist prepass. */
interface OxcComponentHoistCandidate {
    id: string;
    elementId: string;
    dynamicKey: string;
    propertyKey: string;
    variantChain: string;
    valueSource: string;
    valueKey: string;
    info: OxcDynamicPropInfo;
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
 * @param globalVarAliases Exact global custom-property alias table.
 * @param cssVariableMap CSS variable metadata map to populate.
 * @returns Static class tokens, or null when runtime handling is required.
 */
function astArrayToStaticClasses(
    node: ArrayExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue>,
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
            result = compileSzObject(
                applyGlobalVarAliasesToSzObject(
                    astObjectToSzObject(objectNode, filename, bindings),
                    globalVarAliases,
                    cssVariableMap,
                ),
            );
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
 * Compile a conditional sz array (`[base, cond && extra]`) to `_szMerge` args.
 *
 * @param node Array expression used as the sz value.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param globalVarAliases Exact global custom-property alias table.
 * @param cssVariableMap Original-to-mangled CSS variable map to populate.
 * @param source Original source for preserving condition expressions.
 * @param classes Output set collecting every compiled class for the catalog.
 * @returns Comma-joined `_szMerge` arguments, or null when fully static or unresolvable.
 */
function buildArrayMergeExpression(
    node: ArrayExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue>,
    source: string,
    classes: Set<string>,
): string | null {
    const parts: string[] = [];
    let hasConditional = false;

    for (const element of node.elements) {
        if (!element || isFalsyLiteral(element)) {
            continue;
        }
        const unwrapped = unwrapExpression(element);
        let condition: OxcNode | null = null;
        let candidate = unwrapped;
        if (
            unwrapped.type === 'LogicalExpression' &&
            (unwrapped as LogicalExpressionNode).operator === '&&'
        ) {
            const logical = unwrapped as LogicalExpressionNode;
            condition = logical.left;
            candidate = unwrapExpression(logical.right);
            hasConditional = true;
        }
        const objectNode = resolveObjectExpression(candidate, bindings);
        if (!objectNode) {
            return null;
        }
        let result: ReturnType<typeof compileSzObject>;
        try {
            result = compileSzObject(
                applyGlobalVarAliasesToSzObject(
                    astObjectToSzObject(objectNode, filename, bindings),
                    globalVarAliases,
                    cssVariableMap,
                ),
            );
        } catch (err) {
            if (err instanceof OxcNotImplementedError) {
                return null;
            }
            throw err;
        }
        for (const cls of result.className.split(/\s+/)) {
            if (cls) {
                classes.add(cls);
            }
        }
        const classLiteral = JSON.stringify(result.className);
        parts.push(
            condition
                ? `${source.slice(condition.start, condition.end)} && ${classLiteral}`
                : classLiteral,
        );
    }

    return hasConditional ? parts.join(', ') : null;
}

/**
 * Build the `_szMerge` argument that preserves an existing className attribute.
 *
 * @param attribute Existing `className` JSX attribute.
 * @param source Original source for slicing expression values.
 * @returns A JS expression string for the existing className value.
 */
function classNameMergeArgument(attribute: JsxAttributeNode, source: string): string {
    const staticValue = stringLiteralValue(attribute.value);
    if (staticValue !== null) {
        return JSON.stringify(staticValue);
    }
    if (attribute.value?.type === 'JSXExpressionContainer') {
        const expression = (attribute.value as unknown as { expression: OxcNode }).expression;
        return source.slice(expression.start, expression.end);
    }
    return '""';
}

/**
 * Collect statically visible classes from an array that still needs runtime fallback.
 *
 * @param node Array expression used as the sz value.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param classes Class set to populate.
 */
/**
 * Collect statically visible classes from an array that still needs runtime fallback.
 *
 * @param node Array expression used as the sz value.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param classes Class set to populate.
 * @param variantPrefix Current variant prefix chain.
 */
function collectArrayCandidateClasses(
    node: ArrayExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    classes: Set<string>,
    variantPrefix: string,
): void {
    for (const element of node.elements) {
        if (!element || isFalsyLiteral(element)) {
            continue;
        }
        /**
         *
         * @param node
         * @param filename
         * @param bindings
         * @param classes
         * @param variantPrefix
         */
        const candidate =
            element.type === 'LogicalExpression' &&
            (element as LogicalExpressionNode).operator === '&&'
                ? (element as LogicalExpressionNode).right
                : element;
        collectCandidateClassesFromExpression(
            candidate,
            filename,
            bindings,
            classes,
            variantPrefix,
        );
    }
}

/**
 * Collect Tailwind candidate classes from any statically analysable expression.
 *
 * @param node Candidate expression (object, array, identifier, conditional, logical).
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param classes Output set collecting candidate classes for the catalog.
 * @param variantPrefix Variant chain to prefix onto collected classes.
 */
function collectCandidateClassesFromExpression(
    node: OxcNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    classes: Set<string>,
    variantPrefix: string,
): void {
    const unwrapped = unwrapExpression(node);
    if (unwrapped.type === 'ArrayExpression') {
        collectArrayCandidateClasses(
            unwrapped as ArrayExpressionNode,
            filename,
            bindings,
            classes,
            variantPrefix,
        );
    } else if (unwrapped.type === 'ObjectExpression') {
        collectCandidateClassesFromObjectExpression(
            unwrapped as ObjectExpressionNode,
            filename,
            bindings,
            classes,
            variantPrefix,
        );
    } else if (unwrapped.type === 'Identifier') {
        const bound = bindings.get(String((unwrapped as IdentifierNode).name));
        if (bound) {
            collectCandidateClassesFromExpression(
                bound,
                filename,
                bindings,
                classes,
                variantPrefix,
            );
        }
    } else if (unwrapped.type === 'ConditionalExpression') {
        const cond = unwrapped as ConditionalExpressionNode;
        collectCandidateClassesFromExpression(
            cond.consequent,
            filename,
            bindings,
            classes,
            variantPrefix,
        );
        collectCandidateClassesFromExpression(
            cond.alternate,
            filename,
            bindings,
            classes,
            variantPrefix,
        );
    } else if (
        unwrapped.type === 'LogicalExpression' &&
        (unwrapped as LogicalExpressionNode).operator === '&&'
    ) {
        const logical = unwrapped as LogicalExpressionNode;
        collectCandidateClassesFromExpression(
            logical.right,
            filename,
            bindings,
            classes,
            variantPrefix,
        );
    }
}

/**
 * Collect candidate classes from one object expression, including variant nests.
 *
 * @param node Object expression to compile for candidates.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param classes Output set collecting candidate classes for the catalog.
 * @param variantPrefix Variant chain to prefix onto collected classes.
 */
function collectCandidateClassesFromObjectExpression(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    classes: Set<string>,
    variantPrefix: string,
): void {
    try {
        const compiled = compileSzObject(astObjectToSzObject(node, filename, bindings));
        for (const cls of prefixVariantClasses(compiled.className, variantPrefix).split(/\s+/)) {
            if (cls) {
                classes.add(cls);
            }
        }
        return;
    } catch (err) {
        if (!(err instanceof OxcNotImplementedError)) {
            throw err;
        }
    }

    for (const propRaw of node.properties) {
        if (propRaw.type === 'SpreadElement') {
            const spread = propRaw as SpreadElementNode;
            const spreadArg = unwrapExpression(spread.argument);
            if (spreadArg.type === 'Identifier') {
                const bound = bindings.get(String((spreadArg as IdentifierNode).name));
                if (bound) {
                    collectCandidateClassesFromObjectExpression(
                        bound,
                        filename,
                        bindings,
                        classes,
                        variantPrefix,
                    );
                }
            } else {
                collectCandidateClassesFromExpression(
                    spread.argument,
                    filename,
                    bindings,
                    classes,
                    variantPrefix,
                );
            }
        } else if (propRaw.type === 'Property') {
            const prop = propRaw as PropertyNode;
            if (prop.computed) {
                continue;
            }
            const key = extractKeyName(prop.key);
            if (key === null) {
                continue;
            }
            const val = unwrapExpression(prop.value);
            if (val.type === 'ObjectExpression') {
                if (isKnownVariant(key)) {
                    const nestedVariant = variantPrefix ? `${variantPrefix}:${key}` : key;
                    collectCandidateClassesFromObjectExpression(
                        val as ObjectExpressionNode,
                        filename,
                        bindings,
                        classes,
                        nestedVariant,
                    );
                } else {
                    try {
                        const propertyVal = astObjectToSzObject(
                            val as ObjectExpressionNode,
                            filename,
                            bindings,
                        );
                        const singleObject = { [key]: propertyVal };
                        const compiled = compileSzObject(singleObject);
                        for (const c of prefixVariantClasses(
                            compiled.className,
                            variantPrefix,
                        ).split(/\s+/)) {
                            if (c) classes.add(c);
                        }
                    } catch {
                        collectCandidateClassesFromExpression(
                            val,
                            filename,
                            bindings,
                            classes,
                            variantPrefix,
                        );
                    }
                }
            } else if (val.type === 'ConditionalExpression') {
                const cond = val as ConditionalExpressionNode;
                try {
                    const consequentVal = astValueToSzValue(cond.consequent, filename, bindings);
                    const singleConsequent = { [key]: consequentVal };
                    const compiledConsequent = compileSzObject(singleConsequent);
                    for (const c of prefixVariantClasses(
                        compiledConsequent.className,
                        variantPrefix,
                    ).split(/\s+/)) {
                        if (c) classes.add(c);
                    }
                } catch {
                    collectCandidateClassesFromExpression(
                        cond.consequent,
                        filename,
                        bindings,
                        classes,
                        variantPrefix,
                    );
                }
                try {
                    const alternateVal = astValueToSzValue(cond.alternate, filename, bindings);
                    const singleAlternate = { [key]: alternateVal };
                    const compiledAlternate = compileSzObject(singleAlternate);
                    for (const c of prefixVariantClasses(
                        compiledAlternate.className,
                        variantPrefix,
                    ).split(/\s+/)) {
                        if (c) classes.add(c);
                    }
                } catch {
                    collectCandidateClassesFromExpression(
                        cond.alternate,
                        filename,
                        bindings,
                        classes,
                        variantPrefix,
                    );
                }
            } else {
                try {
                    const propertyVal = astValueToSzValue(val, filename, bindings);
                    const singleObject = { [key]: propertyVal };
                    const compiled = compileSzObject(singleObject);
                    for (const c of prefixVariantClasses(compiled.className, variantPrefix).split(
                        /\s+/,
                    )) {
                        if (c) classes.add(c);
                    }
                } catch {
                    collectCandidateClassesFromExpression(
                        val,
                        filename,
                        bindings,
                        classes,
                        variantPrefix,
                    );
                }
            }
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
 * Collect every static class reachable from an szv configuration.
 *
 * @param node Call expression to inspect.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param classes Class set to populate.
 */
function collectSzvCallClasses(
    node: CallExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    classes: Set<string>,
): void {
    if (node.callee.type !== 'Identifier' || (node.callee as IdentifierNode).name !== 'szv') {
        return;
    }
    const [firstArg] = node.arguments;
    if (!firstArg) {
        return;
    }
    /**
     *
     * @param object
     * @param classes
     */
    const configNode = resolveObjectExpression(firstArg, bindings);
    if (!configNode) {
        return;
    }

    // Read `base` and `variants` INDEPENDENTLY rather than converting the whole
    // config. A non-static sibling key (e.g. a `compoundVariants` array) used to
    // throw OxcNotImplementedError for the entire config and drop every variant
    // class; now unknown / dynamic keys are simply ignored.
    const base = readConfigSubObject(configNode, 'base', filename, bindings);
    addCompiledClasses(base, classes);
    const variants = readConfigSubObject(configNode, 'variants', filename, bindings);
    for (const variantValues of Object.values(variants)) {
        if (!isSzObject(variantValues)) {
            continue;
        }
        for (const variantObject of Object.values(variantValues)) {
            if (!isSzObject(variantObject)) {
                continue;
            }
            addCompiledClasses({ ...base, ...variantObject }, classes);
        }
    }
}

/**
 * Read a single named property (`base` / `variants`) of an szv config as a
 * static SzObject, converting ONLY that sub-tree. Returns `{}` when the key is
 * absent, non-static, or hits an unimplemented node — so sibling keys
 * (compoundVariants, defaultVariants, unknown keys) never drop the catalog.
 *
 * @param configNode The szv config object node.
 * @param key The property to read.
 * @param filename For diagnostics.
 * @param bindings Local const-binding map for indirection.
 * @returns The converted SzObject, or `{}`.
 */
function readConfigSubObject(
    configNode: ObjectExpressionNode,
    key: string,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
): SzObject {
    for (const propRaw of configNode.properties) {
        if (propRaw.type !== 'Property') {
            continue;
        }
        const prop = propRaw as PropertyNode;
        if (prop.computed || extractKeyName(prop.key) !== key) {
            continue;
        }
        // An inline object literal OR a same-scope `const` identifier bound to one
        // (`const V = {…}; szv({ variants: V })`). `bindings` is const-only, so a
        // reassigned `let` is never followed — matching Babel's const-guarded
        // resolution.
        const valueObj = resolveObjectExpression(prop.value, bindings);
        if (!valueObj) {
            return {};
        }
        try {
            return astObjectToSzObject(valueObj, filename, bindings);
        } catch (err) {
            if (err instanceof OxcNotImplementedError) {
                return {};
            }
            throw err;
        }
    }
    return {};
}

/**
 * Compile an sz object and add each resulting class to the catalog set.
 *
 * @param object sz object to compile.
 * @param classes Output set collecting the compiled classes.
 */
function addCompiledClasses(object: SzObject, classes: Set<string>): void {
    const result = compileSzObject(object);
    for (const cls of result.className.split(/\s+/)) {
        if (cls) {
            classes.add(cls);
        }
    }
}

/**
 * Narrow an unknown value to a plain (non-array) sz object.
 *
 * @param value Candidate value.
 * @returns True when the value is a plain object usable as an sz config.
 */
function isSzObject(value: unknown): value is SzObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
 * @param globalVarAliases Exact global custom-property alias table.
 * @param cssVariableMap CSS variable metadata map to populate.
 * @returns Ternary className expression source, or null when unsupported.
 */
function buildConditionalSpreadClassExpression(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
    classes: Set<string>,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue>,
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
        globalVarAliases,
        cssVariableMap,
    );
    const alternate = compileConditionalSpreadBranch(
        conditionalSpread.alternate,
        otherProps,
        node,
        filename,
        bindings,
        globalVarAliases,
        cssVariableMap,
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
    // Bare className value: an empty branch becomes `undefined` (no class attribute).
    const branch = (cls: string): string => (cls === '' ? 'undefined' : JSON.stringify(cls));
    return `${testSource} ? ${branch(consequent)} : ${branch(alternate)}`;
}

/**
 * Compile one branch of a conditional object spread plus the static overrides.
 *
 * @param branch Conditional branch expression.
 * @param otherProps Static properties outside the spread.
 * @param sourceNode Source object node used for span fields.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param globalVarAliases Exact global custom-property alias table.
 * @param cssVariableMap CSS variable metadata map to populate.
 * @returns Compiled class string, or null when unsupported.
 */
function compileConditionalSpreadBranch(
    branch: OxcNode,
    otherProps: OxcNode[],
    sourceNode: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue>,
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
        return compileSzObject(
            applyGlobalVarAliasesToSzObject(
                { ...branchValue, ...overrides },
                globalVarAliases,
                cssVariableMap,
            ),
        ).className;
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
 * @param options Transform options controlling opt-in CSS variable behavior.
 * @param hoistedNames Dynamic prop keys that should use component-tier hoisted vars.
 * @param cssVariableMap Original-to-mangled CSS variable map to populate.
 * @param reservedNames User-authored CSS custom-property names to avoid.
 * @param globalVarAliases Exact global custom-property alias table.
 * @returns Transform fragments, or null when the object needs runtime fallback.
 */
function buildPartialObjectTransform(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
    options?: TransformSourceCodeOptions,
    hoistedNames?: ReadonlyMap<string, string>,
    cssVariableMap?: Map<string, CssVariableMangleValue>,
    reservedNames?: ReadonlySet<string>,
    globalVarAliases: ReadonlyMap<string, string> = new Map(),
): OxcPartialTransform | null {
    const partial = evaluatePartialObject(
        node,
        filename,
        bindings,
        source,
        globalVarAliases,
        cssVariableMap,
    );
    if (!partial || (partial.dynamicProps.size === 0 && partial.conditionalClasses.length === 0)) {
        return null;
    }
    // One conditional prop may coexist with static props (the static part stays
    // build-time, only the conditional becomes a runtime ternary). Mixing a
    // conditional with runtime css vars still falls back to the runtime.
    if (
        partial.conditionalClasses.length > 0 &&
        (partial.conditionalClasses.length !== 1 || partial.dynamicProps.size > 0)
    ) {
        return null;
    }

    const classParts: string[] = [];
    if (Object.keys(partial.staticProps).length > 0) {
        const { className } = compileSzObject(
            applyGlobalVarAliasesToSzObject(partial.staticProps, globalVarAliases, cssVariableMap),
        );
        if (className) {
            classParts.push(className);
        }
    }

    if (options?.mangleVars) {
        applyHoistedVariableNames(partial, hoistedNames, cssVariableMap);
        applyScopedVariablePlan(partial, hoistedNames, cssVariableMap, reservedNames);
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
            : className === ''
              ? // An sz that lowers to zero classes emits `className={undefined}` so the
                // DOM has no `class` attribute, instead of the noisy `class=""`.
                'className={undefined}'
              : `className="${className}"`;
    const styleProps = [...partial.dynamicProps.entries()]
        .filter(([id]) => !hoistedNames?.has(id))
        .map(
            ([, info]) =>
                `${JSON.stringify(info.varName)}: ${generateStyleValueSource(info, source)}`,
        );
    return {
        className,
        classNameAttr,
        styleProps,
        usesColorVar: partial.usesColorVar,
        hasConditional: partial.conditionalClasses.length > 0,
    };
}

/**
 * Applies precomputed component-tier names for hoisted dynamic vars.
 *
 * @param partial Partially evaluated sz object result for one JSX element.
 * @param hoistedNames Dynamic prop key to hoisted CSS var name.
 * @param cssVariableMap Original-to-mangled CSS variable map to populate.
 */
function applyHoistedVariableNames(
    partial: OxcPartialObjectResult,
    hoistedNames?: ReadonlyMap<string, string>,
    cssVariableMap?: Map<string, CssVariableMangleValue>,
): void {
    if (!hoistedNames) {
        return;
    }
    for (const [id, name] of hoistedNames) {
        const info = partial.dynamicProps.get(id);
        if (info) {
            addCssVariableMapping(cssVariableMap, info.varName, name);
            info.varName = name;
        }
    }
}

/**
 * Applies the opt-in scoped tier plan for dynamic vars on one JSX element.
 *
 * This intentionally only handles the element-local `s` tier. Component-tier
 * `c` naming and hoisting need ancestor analysis and land in a later slice.
 *
 * @param partial Partially evaluated sz object result for one JSX element.
 * @param hoistedNames Dynamic prop keys already assigned to component-tier hoisted vars.
 * @param cssVariableMap Original-to-mangled CSS variable map to populate.
 * @param reservedNames User-authored CSS custom-property names to avoid.
 */
function applyScopedVariablePlan(
    partial: OxcPartialObjectResult,
    hoistedNames?: ReadonlyMap<string, string>,
    cssVariableMap?: Map<string, CssVariableMangleValue>,
    reservedNames?: ReadonlySet<string>,
): void {
    const entries = [...partial.dynamicProps.entries()].filter(([id]) => !hoistedNames?.has(id));
    const plan = planCSSVariableNames(
        entries.map(([id]) => ({
            id,
            tier: 'scoped',
            elementId: 'self',
            propertyKey: id,
        })),
        { reservedNames },
    );

    for (const planned of plan) {
        const info = partial.dynamicProps.get(planned.id);
        if (info) {
            addCssVariableMapping(cssVariableMap, info.varName, planned.name);
            info.varName = planned.name;
        }
    }
}

/**
 * Adds one CSS variable mangle mapping while preserving one-to-many fanout.
 *
 * @param cssVariableMap Metadata map to update.
 * @param original Original generated CSS custom-property name.
 * @param mangled Scoped or hoisted custom-property name.
 */
function addCssVariableMapping(
    cssVariableMap: Map<string, CssVariableMangleValue> | undefined,
    original: string,
    mangled: string,
): void {
    if (!cssVariableMap) {
        return;
    }
    const existing = cssVariableMap.get(original);
    if (!existing) {
        cssVariableMap.set(original, mangled);
        return;
    }
    const values = Array.isArray(existing) ? existing : [existing];
    if (!values.includes(mangled)) {
        cssVariableMap.set(original, [...values, mangled]);
    }
}

/**
 * Normalize caller-provided global variable alias tables.
 *
 * Only exact CSS custom-property names participate. Invalid entries are ignored
 * here because config/planner validation owns user-facing diagnostics.
 *
 * @param input Alias table input.
 * @returns Normalized alias map.
 */
function normalizeGlobalVarAliases(
    input: TransformSourceCodeOptions['globalVarAliases'],
): Map<string, string> {
    if (!input) {
        return new Map();
    }
    const entries =
        input instanceof Map
            ? input.entries()
            : Array.isArray(input)
              ? input
              : Object.entries(input);
    const aliases = new Map<string, string>();
    for (const [original, alias] of entries) {
        if (original.startsWith('--') && alias.startsWith('--')) {
            aliases.set(original, alias);
        }
    }
    return aliases;
}

/**
 * Rewrites exact static sz string values through the global variable alias map.
 *
 * @param object Static sz object.
 * @param globalVarAliases Exact original-to-alias custom-property names.
 * @param cssVariableMap CSS variable metadata map to populate.
 * @returns Static sz object with aliased string values.
 */
function applyGlobalVarAliasesToSzObject(
    object: SzObject,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue> | undefined,
): SzObject {
    if (globalVarAliases.size === 0) {
        return object;
    }

    const rewritten: SzObject = {};
    for (const [key, value] of Object.entries(object)) {
        rewritten[key] = applyGlobalVarAliasesToSzValue(value, globalVarAliases, cssVariableMap);
    }
    return rewritten;
}

/**
 * Rewrites one static sz value through the global variable alias map.
 *
 * @param value Static sz value.
 * @param globalVarAliases Exact original-to-alias custom-property names.
 * @param cssVariableMap CSS variable metadata map to populate.
 * @returns Rewritten value.
 */
function applyGlobalVarAliasesToSzValue(
    value: SzValue,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue> | undefined,
): SzValue {
    if (typeof value === 'string') {
        const alias = globalVarAliases.get(value);
        if (alias) {
            addCssVariableMapping(cssVariableMap, value, alias);
            return alias;
        }
        return value;
    }
    if (typeof value === 'object') {
        return applyGlobalVarAliasesToSzObject(value, globalVarAliases, cssVariableMap);
    }
    return value;
}

/**
 * Plans component-tier CSS variable hoists from the oxc JSX tree.
 *
 * This prepass is intentionally read-only. It only emits rewrite metadata for
 * dynamic vars that share the same generated component var name and the same
 * runtime style value source inside a bounded JSX ancestor chain.
 *
 * @param root Parsed program root.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param source Original source for expression slicing.
 * @param maxDepth Maximum cascade distance for component-tier hoisting.
 * @param reservedNames User-authored CSS custom-property names to avoid.
 * @returns Hoist metadata consumed by the source rewrite pass.
 */
function planOxcComponentVariableHoists(
    root: OxcNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
    maxDepth?: number,
    reservedNames?: ReadonlySet<string>,
): OxcComponentHoistAnalysis {
    const nodes: CSSVariableHoistNode[] = [];
    const candidates: OxcComponentHoistCandidate[] = [];

    collectOxcHoistCandidates(root, null, nodes, candidates, filename, bindings, source);
    if (candidates.length < 2) {
        return {
            stylePropsByTarget: new Map(),
            usageNamesByElement: new Map(),
            diagnostics: [],
        };
    }

    const plannedNames = planCSSVariableNames(
        candidates.map(candidate => ({
            id: candidate.id,
            tier: 'component',
            elementId: candidate.elementId,
            propertyKey: candidate.propertyKey,
            variantChain: candidate.variantChain || undefined,
        })),
        { reservedNames },
    );
    const nameByUsage = new Map(plannedNames.map(entry => [entry.id, entry.name]));
    const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const hoistUsages: CSSVariableHoistUsage[] = candidates.map(candidate => ({
        id: candidate.id,
        elementId: candidate.elementId,
        name: nameByUsage.get(candidate.id) ?? candidate.info.varName,
        valueKey: candidate.valueKey,
    }));
    const analysis = planComponentVariableHoistsWithDiagnostics(nodes, hoistUsages, {
        maxDepth,
    });
    const plans = analysis.plans;
    const stylePropsByTarget = new Map<string, string[]>();
    const usageNamesByElement = new Map<string, Map<string, string>>();

    for (const plan of plans) {
        const [firstUsageId] = plan.usageIds;
        const firstCandidate = firstUsageId ? candidateById.get(firstUsageId) : undefined;
        if (!firstCandidate) {
            continue;
        }
        appendMapArray(
            stylePropsByTarget,
            plan.targetElementId,
            `${JSON.stringify(plan.name)}: ${firstCandidate.valueSource}`,
        );
        for (const usageId of plan.usageIds) {
            const candidate = candidateById.get(usageId);
            if (!candidate) {
                continue;
            }
            getOrCreateMap(usageNamesByElement, candidate.elementId).set(
                candidate.dynamicKey,
                plan.name,
            );
        }
    }

    return {
        stylePropsByTarget,
        usageNamesByElement,
        diagnostics: analysis.diagnostics.map(formatHoistSkipDiagnostic),
    };
}

/**
 * Formats a stable diagnostic for a skipped component-tier CSS variable hoist.
 *
 * @param diagnostic Planner skip diagnostic.
 * @returns User-facing compiler diagnostic.
 */
function formatHoistSkipDiagnostic(diagnostic: CSSVariableHoistDiagnostic): string {
    const suffix =
        diagnostic.reason === 'max-depth' && diagnostic.maxDepth !== undefined
            ? ` (maxDepth ${diagnostic.maxDepth})`
            : '';
    return `[csszyx] mangleVars skipped component CSS variable hoist for ${diagnostic.name} across ${diagnostic.usageCount} usages: ${diagnostic.reason}${suffix}`;
}

/**
 * Collects JSX host nodes and dynamic CSS-var candidates for component hoisting.
 *
 * @param node Current AST node.
 * @param parentElementId Current JSX parent id.
 * @param nodes Hoist tree nodes to populate.
 * @param candidates Dynamic var candidates to populate.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param source Original source for expression slicing.
 */
function collectOxcHoistCandidates(
    node: OxcNode,
    parentElementId: string | null,
    nodes: CSSVariableHoistNode[],
    candidates: OxcComponentHoistCandidate[],
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
): void {
    if (node.type === 'JSXElement') {
        const element = node as JsxElementNode;
        const opening = element.openingElement;
        const elementId = elementIdForOpening(opening);
        nodes.push({
            id: elementId,
            parentId: parentElementId,
            canHost: canHostHoistedStyleProps(opening),
        });
        collectOpeningHoistCandidates(opening, elementId, candidates, filename, bindings, source);
        for (const child of element.children) {
            collectOxcHoistCandidates(
                child,
                elementId,
                nodes,
                candidates,
                filename,
                bindings,
                source,
            );
        }
        return;
    }

    if (node.type === 'JSXFragment') {
        const fragment = node as JsxFragmentNode;
        const elementId = `f${node.start}`;
        nodes.push({ id: elementId, parentId: parentElementId, canHost: false });
        for (const child of fragment.children) {
            collectOxcHoistCandidates(
                child,
                elementId,
                nodes,
                candidates,
                filename,
                bindings,
                source,
            );
        }
        return;
    }

    for (const key of Object.keys(node)) {
        if (isAstMetadataKey(key)) {
            continue;
        }
        const child = (node as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                if (isOxcNode(item)) {
                    collectOxcHoistCandidates(
                        item,
                        parentElementId,
                        nodes,
                        candidates,
                        filename,
                        bindings,
                        source,
                    );
                }
            }
        } else if (isOxcNode(child)) {
            collectOxcHoistCandidates(
                child,
                parentElementId,
                nodes,
                candidates,
                filename,
                bindings,
                source,
            );
        }
    }
}

/**
 * Collects dynamic vars from one JSX opening element's `sz` object.
 *
 * @param opening JSX opening element.
 * @param elementId Stable element id.
 * @param candidates Candidate list to populate.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param source Original source for expression slicing.
 */
function collectOpeningHoistCandidates(
    opening: JsxOpeningElementNode,
    elementId: string,
    candidates: OxcComponentHoistCandidate[],
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
): void {
    for (const attrRaw of opening.attributes ?? []) {
        if (attrRaw.type !== 'JSXAttribute') {
            continue;
        }
        const attr = attrRaw as JsxAttributeNode;
        if (attr.name?.name !== 'sz' || attr.value?.type !== 'JSXExpressionContainer') {
            continue;
        }
        const expression = (attr.value as unknown as { expression: OxcNode }).expression;
        if (expression.type !== 'ObjectExpression') {
            continue;
        }
        const partial = evaluatePartialObject(
            expression as ObjectExpressionNode,
            filename,
            bindings,
            source,
            new Map(),
            undefined,
        );
        if (!partial || partial.conditionalClasses.length > 0) {
            continue;
        }
        for (const [dynamicKey, info] of partial.dynamicProps) {
            candidates.push({
                id: `${elementId}:${dynamicKey}`,
                elementId,
                dynamicKey,
                propertyKey: dynamicKey,
                variantChain: info.variantChain,
                valueSource: generateStyleValueSource(info, source),
                valueKey: buildDynamicValueKey(info, source),
                info,
            });
        }
    }
}

/**
 * Builds a stable id for a JSX opening element.
 *
 * @param opening JSX opening element.
 * @returns Element id derived from the opening tag offset.
 */
function elementIdForOpening(opening: JsxOpeningElementNode): string {
    return `e${opening.start}`;
}

/**
 * Checks whether a JSX opening element can receive hoisted style props.
 *
 * @param opening JSX opening element.
 * @returns True for DOM hosts with absent or expression style props.
 */
function canHostHoistedStyleProps(opening: JsxOpeningElementNode): boolean {
    if (!isDomJsxOpening(opening)) {
        return false;
    }
    const styleAttr = findJsxAttribute(opening, 'style');
    return !styleAttr || styleAttr.value?.type === 'JSXExpressionContainer';
}

/**
 * Checks whether a JSX opening element is a DOM tag rather than a component.
 *
 * @param opening JSX opening element.
 * @returns True for lowercase JSX identifiers.
 */
function isDomJsxOpening(opening: JsxOpeningElementNode): boolean {
    if (opening.name.type !== 'JSXIdentifier') {
        return false;
    }
    const name = String((opening.name as unknown as { name: string }).name);
    return name.length > 0 && name.charAt(0) === name.charAt(0).toLowerCase();
}

/**
 * Finds a JSX attribute by name.
 *
 * @param opening JSX opening element.
 * @param name Attribute name.
 * @returns Matching JSX attribute, if present.
 */
function findJsxAttribute(opening: JsxOpeningElementNode, name: string): JsxAttributeNode | null {
    for (const attrRaw of opening.attributes ?? []) {
        if (attrRaw.type === 'JSXAttribute') {
            const attr = attrRaw as JsxAttributeNode;
            if (attr.name?.name === name) {
                return attr;
            }
        }
    }
    return null;
}

/**
 * Collects user-authored inline CSS custom-property names from static style objects.
 *
 * @param node AST node to scan.
 * @returns CSS custom-property names that mangleVars must not reuse.
 */
function collectStaticStyleCustomPropertyNames(node: OxcNode): Set<string> {
    const names = new Set<string>();
    walk(node, child => {
        if (child.type !== 'JSXOpeningElement') {
            return;
        }
        const styleAttr = findJsxAttribute(child as unknown as JsxOpeningElementNode, 'style');
        if (styleAttr?.value?.type !== 'JSXExpressionContainer') {
            return;
        }
        const expression = (styleAttr.value as unknown as { expression: OxcNode }).expression;
        if (expression.type !== 'ObjectExpression') {
            return;
        }
        for (const propRaw of (expression as ObjectExpressionNode).properties ?? []) {
            if (propRaw.type !== 'Property') {
                continue;
            }
            const key = (propRaw as PropertyNode).key;
            const name = literalStringValue(key);
            if (name?.startsWith('--')) {
                names.add(name);
            }
        }
    });
    return names;
}

/**
 * Extracts a string literal AST value.
 *
 * @param node AST node.
 * @returns Literal string value, or null.
 */
function literalStringValue(node: OxcNode): string | null {
    if (node.type !== 'Literal') {
        return null;
    }
    const value = (node as unknown as { value: unknown }).value;
    return typeof value === 'string' ? value : null;
}

/**
 * Appends a value into an array-valued map.
 *
 * @param map Map to update.
 * @param key Map key.
 * @param value Value to append.
 */
function appendMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const existing = map.get(key);
    if (existing) {
        existing.push(value);
    } else {
        map.set(key, [value]);
    }
}

/**
 * Gets or creates a nested map.
 *
 * @param map Outer map.
 * @param key Outer key.
 * @returns Inner map.
 */
function getOrCreateMap<K, NK, NV>(map: Map<K, Map<NK, NV>>, key: K): Map<NK, NV> {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }
    const value = new Map<NK, NV>();
    map.set(key, value);
    return value;
}

/**
 * Partially evaluate an object expression into static props and CSS-variable props.
 *
 * @param node Object expression to evaluate.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param source Original source for preserving runtime expressions.
 * @param globalVarAliases Exact global custom-property alias table.
 * @param cssVariableMap CSS variable metadata map to populate.
 * @param variantChain Current nested variant chain.
 * @returns Partial object result, or null for unsupported spread/computed cases.
 */
function evaluatePartialObject(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue> | undefined,
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
                globalVarAliases,
                cssVariableMap,
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
                const { className: consequentClasses } = compileSzObject(
                    applyGlobalVarAliasesToSzObject(
                        { [key]: consequent },
                        globalVarAliases,
                        cssVariableMap,
                    ),
                );
                const { className: alternateClasses } = compileSzObject(
                    applyGlobalVarAliasesToSzObject(
                        { [key]: alternate },
                        globalVarAliases,
                        cssVariableMap,
                    ),
                );
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
 * @param fallbackInsertOffset Offset to use when the element has no attributes.
 */
function applyStyleProps(
    edits: MagicString,
    source: string,
    styleAttr: JsxAttributeNode | null,
    lastAttr: JsxAttributeNode | null,
    styleProps: string[],
    fallbackInsertOffset?: number,
): void {
    if (styleProps.length === 0) {
        return;
    }
    const propsSource = styleProps.join(', ');
    if (!styleAttr) {
        const insertOffset = lastAttr?.end ?? fallbackInsertOffset;
        if (insertOffset !== undefined) {
            edits.appendRight(insertOffset, ` style={{${propsSource}}}`);
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
 * Builds the normalized identity used for comparing dynamic CSS variable values.
 *
 * @param info Dynamic prop metadata.
 * @param source Original source for expression slicing.
 * @returns Category-prefixed normalized expression key.
 */
function buildDynamicValueKey(info: OxcDynamicPropInfo, source: string): string {
    const expressionSource = normalizeDynamicExpressionKey(
        source.slice(info.expression.start, info.expression.end),
    );
    switch (info.category) {
        case PropertyCategory.SPACING:
            return `spacing:${expressionSource}`;
        case PropertyCategory.COLOR:
            return `color:${expressionSource}`;
        case PropertyCategory.ANGLE:
            return `angle:${expressionSource}`;
        case PropertyCategory.DURATION:
            return `duration:${expressionSource}`;
        default:
            return `pass:${expressionSource}`;
    }
}

/**
 * Normalizes expression text only where semantics are structurally obvious.
 *
 * @param expressionSource Runtime expression source.
 * @returns Trimmed expression with redundant outer parentheses removed.
 */
function normalizeDynamicExpressionKey(expressionSource: string): string {
    let normalized = expressionSource.trim();
    while (hasRedundantOuterParens(normalized)) {
        normalized = normalized.slice(1, -1).trim();
    }
    return normalized;
}

/**
 * Checks whether one pair of outer parentheses wraps the full expression.
 *
 * @param expressionSource Trimmed expression source.
 * @returns True when removing the outer pair preserves grouping.
 */
function hasRedundantOuterParens(expressionSource: string): boolean {
    if (!expressionSource.startsWith('(') || !expressionSource.endsWith(')')) {
        return false;
    }
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;
    for (let index = 0; index < expressionSource.length; index++) {
        const char = expressionSource[index];
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            continue;
        }
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
            if (depth === 0 && index !== expressionSource.length - 1) {
                return false;
            }
        }
        if (depth < 0) {
            return false;
        }
    }
    return depth === 0;
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
    if (conditionals.length === 1) {
        const [entry] = conditionals;
        // classParts ends with the conditional's [consequent, alternate]; what
        // precedes them is the build-time static class list.
        const staticParts = classParts.slice(0, -2).filter(Boolean);
        const bare = staticParts.length === 0;
        // In bare value position an empty branch becomes `undefined` so it renders
        // no class attribute. Inside the template literal below it MUST stay an
        // empty string — `${undefined}` would render the text "undefined".
        const branch = (cls: string): string =>
            bare && cls === '' ? 'undefined' : JSON.stringify(cls);
        const ternary = `${source.slice(entry.test.start, entry.test.end)} ? ${branch(entry.consequent)} : ${branch(entry.alternate)}`;
        if (bare) {
            return ternary;
        }
        return `\`${staticParts.join(' ')} \${${ternary}}\``;
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
 * @param globalVarAliases Exact global custom-property alias table.
 * @param cssVariableMap CSS variable metadata map to populate.
 * @returns Source for a className expression, or null when a branch is dynamic.
 */
function buildStaticConditionalClassExpression(
    node: ConditionalExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
    classes: Set<string>,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue>,
): string | null {
    const consequent = resolveStaticClassString(
        node.consequent,
        filename,
        bindings,
        globalVarAliases,
        cssVariableMap,
    );
    const alternate = resolveStaticClassString(
        node.alternate,
        filename,
        bindings,
        globalVarAliases,
        cssVariableMap,
    );
    if (consequent === null || alternate === null) {
        return null;
    }
    for (const cls of `${consequent} ${alternate}`.split(/\s+/)) {
        if (cls) {
            classes.add(cls);
        }
    }
    const testSource = source.slice(node.test.start, node.test.end);
    // This ternary is used directly as the className value (`className={…}`), so an
    // empty branch becomes `undefined` (renders no class attribute) rather than "".
    const branch = (cls: string): string => (cls === '' ? 'undefined' : JSON.stringify(cls));
    return `${testSource} ? ${branch(consequent)} : ${branch(alternate)}`;
}

/**
 * Resolve an expression that Babel's tryStaticTransformNode can turn into a class string.
 *
 * @param node Candidate expression.
 * @param filename Filename for diagnostic offsets.
 * @param bindings Local object-literal bindings.
 * @param globalVarAliases Exact global custom-property alias table.
 * @param cssVariableMap CSS variable metadata map to populate.
 * @returns Compiled class string, or null when dynamic.
 */
function resolveStaticClassString(
    node: OxcNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue>,
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
        return compileSzObject(
            applyGlobalVarAliasesToSzObject(
                astObjectToSzObject(objectNode, filename, bindings),
                globalVarAliases,
                cssVariableMap,
            ),
        ).className;
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
 * @param constOnly When true, only `const` declarations are collected (used by
 *   szv config resolution, which must not follow a reassigned `let`).
 * @returns Identifier name to object-expression initializer.
 */
function collectObjectBindings(
    root: OxcNode,
    constOnly = false,
): Map<string, ObjectExpressionNode> {
    const bindings = new Map<string, ObjectExpressionNode>();
    walk(root, node => {
        if (node.type !== 'VariableDeclaration') {
            return;
        }
        const decl = node as unknown as { kind?: string; declarations?: OxcNode[] };
        // szv binding-resolution (constOnly) follows ONLY `const`, so a reassigned
        // `let`/`var` is never resolved to its first object literal. The general
        // sz-object resolution keeps all kinds (existing behaviour / Babel parity).
        if (constOnly && decl.kind !== 'const') {
            return;
        }
        if (!decl.declarations) {
            return;
        }
        for (const declaratorNode of decl.declarations) {
            const declarator = declaratorNode as unknown as {
                id?: OxcNode;
                init?: OxcNode | null;
            };
            const id = declarator.id;
            const init = declarator.init;
            if (!id || id.type !== 'Identifier' || !init) {
                continue;
            }
            const unwrapped = unwrapExpression(init);
            if (unwrapped.type === 'ObjectExpression') {
                bindings.set(
                    String((id as IdentifierNode).name),
                    unwrapped as ObjectExpressionNode,
                );
            }
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
 * Checks whether an unknown value has the minimum oxc node shape.
 *
 * @param value Unknown value.
 * @returns True when value looks like an oxc AST node.
 */
function isOxcNode(value: unknown): value is OxcNode {
    return Boolean(
        value && typeof value === 'object' && typeof (value as OxcNode).type === 'string',
    );
}

/**
 * Filters non-structural AST fields during generic traversal.
 *
 * @param key Object key.
 * @returns True when the key should not be traversed.
 */
function isAstMetadataKey(key: string): boolean {
    return key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'type';
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
    if (!isOxcNode(node)) {
        return;
    }
    const typed = node;
    visit(typed);
    for (const key of Object.keys(typed)) {
        if (isAstMetadataKey(key)) {
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
