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
    deepMergeSzObjects,
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
    // Classes discovered from `szs` slot values. Kept OUT of `classes` until the
    // walk completes so the discovery order is deterministic across engines: all
    // sz-derived classes (document order) first, then all szs-derived classes
    // (document order). Mangle IDs are assigned in discovery order, so this
    // ordering is part of the three-engine parity contract.
    const szsPendingClasses: string[] = [];
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
            usesSzcn: false,
            usesSzPart: false,
            usesColorVar: false,
            usesSpacingVar: false,
            usesUnitVar: false,
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
    // Parse plain `.js` / `.mjs` / `.cjs` with JSX enabled: React-17-era code
    // keeps JSX in `.js`, oxc's extension mapping picks a JSX-less grammar, and
    // the parse error used to bounce every such file to the Babel fallback (and
    // silently emptied the native engine's scan). JSX-enabled JS is a superset.
    const parsed = /\.(?:js|mjs|cjs)$/.test(effectiveFilename)
        ? parseSync(effectiveFilename, source, { lang: 'jsx' })
        : parseSync(effectiveFilename, source);
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
    // Any-initializer const map for the szv catalog's per-key leaf resolution
    // (`mx: GUTTER` where `const GUTTER = 0`); the object-only map above cannot
    // hold scalar initializers.
    const constInitializers = collectConstInitializers(parsed.program as unknown as OxcNode);
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
    let usesSzcn = false;
    let usesSzPart = false;
    let usesColorVar = false;
    let usesSpacingVar = false;
    let usesUnitVar = false;

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
                constObjectBindings,
                constInitializers,
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
        const szsAttrs: JsxAttributeNode[] = [];
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
            } else if (name === 'szs') {
                szsAttrs.push(attr);
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

        // szs handling: compile each slot VALUE of the slot-map to its class
        // string (keeping the key) so the component can forward
        // `props.szs?.<slot>` into a child className. Runs BEFORE the sz loop
        // because that loop returns early on several paths. The v1 contract
        // (identifier keys; pure-literal object or class-string values) is
        // enforced identically across all three engines.
        for (const szsAttr of szsAttrs) {
            if (isHostOpeningElementName(openingNode.name as unknown as OxcNode)) {
                diagnostics.push(
                    `[csszyx] szs at ${effectiveFilename}: ` +
                        'szs has no effect on a host element — it maps slot names of a ' +
                        'custom component. Attribute left unchanged.',
                );
                continue;
            }
            const szsValue = szsAttr.value;
            const szsExpression =
                szsValue && szsValue.type === 'JSXExpressionContainer'
                    ? (szsValue as unknown as { expression: OxcNode }).expression
                    : null;
            if (!szsExpression || szsExpression.type !== 'ObjectExpression') {
                diagnostics.push(szsUnsupportedMessage(effectiveFilename));
                continue;
            }
            const slotMap = szsExpression as ObjectExpressionNode;
            if (!isValidSzsSlotMap(slotMap)) {
                diagnostics.push(szsUnsupportedMessage(effectiveFilename));
                continue;
            }
            const { line: szsWarnLine } = offsetToLineColumn(source, szsAttr.start);
            setSzWarnLocation(
                formatSzWarnLocation(effectiveFilename, szsWarnLine, options?.rootDir),
            );
            // Two phases so a failure never leaves the attribute partially
            // rewritten: compile everything first, then emit.
            const slotEntries: Array<{ keyText: string; classNames: string; text: string }> = [];
            let slotFailed = false;
            for (const propRaw of slotMap.properties) {
                const prop = propRaw as PropertyNode;
                const keyText = source.slice(prop.key.start, prop.key.end);
                const propValue = prop.value;
                const literal =
                    propValue.type === 'Literal'
                        ? (propValue as unknown as { value: unknown }).value
                        : null;
                if (typeof literal === 'string') {
                    // Raw class string (also pass-1 output, so the transform is
                    // idempotent): safelist, keep the original text.
                    slotEntries.push({
                        keyText,
                        classNames: literal,
                        text: source.slice(propValue.start, propValue.end),
                    });
                    continue;
                }
                try {
                    const slotObject = astObjectToSzObject(
                        propValue as ObjectExpressionNode,
                        effectiveFilename,
                        objectBindings,
                    );
                    const compiled = compileSzObject(
                        applyGlobalVarAliasesToSzObject(
                            slotObject,
                            globalVarAliases,
                            cssVariableMap,
                        ),
                    ).className;
                    slotEntries.push({
                        keyText,
                        classNames: compiled,
                        text: JSON.stringify(compiled),
                    });
                } catch (err) {
                    if (err instanceof OxcNotImplementedError) {
                        slotFailed = true;
                        break;
                    }
                    throw err;
                }
            }
            setSzWarnLocation(undefined);
            if (slotFailed) {
                diagnostics.push(szsUnsupportedMessage(effectiveFilename));
                continue;
            }
            // The compiled map lands on `szsc` — the read-side prop typed as
            // strings — so the authoring prop `szs` never reaches runtime and
            // the component forwards `szsc?.<slot>` into a child className
            // with no cast. Renamed even when every slot was already a class
            // string (the component reads only `szsc`); idempotent because
            // `szsc` attributes are never matched by this loop.
            const body = slotEntries.map(entry => `${entry.keyText}: ${entry.text}`).join(', ');
            edits.overwrite(
                szsAttr.start,
                szsAttr.end,
                body === '' ? 'szsc={{}}' : `szsc={{ ${body} }}`,
            );
            transformed = true;
            for (const entry of slotEntries) {
                for (const c of entry.classNames.split(/\s+/)) {
                    if (c) {
                        szsPendingClasses.push(c);
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
                const composition = buildArrayComposition(expression as ArrayExpressionNode, {
                    filename: effectiveFilename,
                    bindings: objectBindings,
                    globalVarAliases,
                    cssVariableMap,
                    source,
                    classes,
                    diagnostics,
                });
                if (composition === null) {
                    // Spread element etc. — the whole array stays a runtime value.
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
                if (composition.kind === 'static') {
                    for (const c of composition.classes) {
                        szDerived.push(c);
                        classes.add(c);
                    }
                    continue;
                }
                // szcn lane: later element wins per property group at runtime.
                // An existing className joins as the FIRST argument, so sz
                // composition (and its overrides) applies after it.
                const existingExpression = classNameAttr
                    ? classNameMergeArgument(classNameAttr, source)
                    : null;
                // `_szcn` = the unmemoized szcn twin: compiled arrays carry
                // per-render runtime parts, which would thrash (and evict)
                // the authored-szcn memo.
                const call = existingExpression
                    ? `_szcn(${existingExpression}, ${composition.args})`
                    : `_szcn(${composition.args})`;
                if (classNameAttr) {
                    edits.overwrite(classNameAttr.start, classNameAttr.end, `className={${call}}`);
                    edits.remove(whitespaceStart(source, szAttr.start), szAttr.end);
                } else {
                    edits.overwrite(szAttr.start, szAttr.end, `className={${call}}`);
                }
                usesSzcn = true;
                usesSzPart ||= composition.usesSzPart;
                transformed = true;
                return;
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
                    const nestedConditionalClassExpr = buildNestedConditionalClassExpression(
                        expression as ObjectExpressionNode,
                        effectiveFilename,
                        objectBindings,
                        source,
                        classes,
                        globalVarAliases,
                        cssVariableMap,
                    );
                    if (nestedConditionalClassExpr) {
                        if (classNameAttr || szAttrs.length > 1) {
                            runtimeFallbackExpr = expression;
                            runtimeFallbackAttr = szAttr;
                            break;
                        }
                        edits.overwrite(
                            szAttr.start,
                            szAttr.end,
                            `className={${nestedConditionalClassExpr}}`,
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
                            usesSpacingVar ||= partial.usesSpacingVar;
                            usesUnitVar ||= partial.usesUnitVar;
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
                        usesSpacingVar ||= partial.usesSpacingVar;
                        usesUnitVar ||= partial.usesUnitVar;
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
            const classNameValue = classNameAttr.value;
            if (
                existingRaw === null &&
                classNameValue &&
                classNameValue.type === 'JSXExpressionContainer'
            ) {
                // className holds an EXPRESSION (ternary / identifier / clsx(...)).
                // Overwriting it with the compiled string would silently delete the
                // expression's classes at runtime — the classic symptom was a panel
                // losing its `dems-panel` class next to a static sz. Merge instead,
                // keeping the expression, exactly like babel and the native engine:
                // `className={_szMerge(<expr>, "<compiled>")}`.
                const exprNode = (classNameValue as unknown as { expression: OxcNode }).expression;
                const exprSource = source.slice(exprNode.start, exprNode.end);
                edits.overwrite(
                    classNameAttr.start,
                    classNameAttr.end,
                    `className={_szMerge(${exprSource}, ${JSON.stringify(szDerived.join(' '))})}`,
                );
                for (const szAttr of szAttrs) {
                    const deleteStart = whitespaceStart(source, szAttr.start);
                    edits.remove(deleteStart, szAttr.end);
                }
                usesRuntime = true;
                usesMerge = true;
                transformed = true;
                return;
            }
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

    // szs classes join AFTER every sz-derived class so the discovery order
    // (which fixes production mangle IDs) matches the other engines.
    for (const c of szsPendingClasses) {
        classes.add(c);
    }

    return {
        code: transformed ? edits.toString() : source,
        transformed,
        usesRuntime,
        usesMerge,
        usesSzcn,
        usesSzPart,
        usesColorVar,
        usesSpacingVar,
        usesUnitVar,
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
 * Diagnostic for an array element that is a visible object literal but still
 * degrades to `_szPart` because one of its values is a runtime expression.
 *
 * @param node The degraded array element.
 * @param source Original source for position computation.
 * @returns The formatted diagnostic string.
 */
function buildSzPartElementDiagnostic(node: OxcNode, source: string): string {
    const { line, column } = offsetToLineColumn(source, node.start);
    return (
        `sz array element at ${line}:${column + 1}: this object literal contains a runtime ` +
        'value, so the whole element is deferred to _szPart at runtime (its classes are ' +
        'still safelisted best-effort).\n  Suggestion: lift the condition to the element ' +
        'level (cond ? { a } : { b }) or move runtime values to dynamic().'
    );
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
/**
 * Whether a JSX opening-element name is a host (DOM) element — a plain
 * lowercase identifier like `div`. Uppercase identifiers and member
 * expressions (`Card.Header`) are custom components.
 *
 * @param nameNode The opening element's name AST node.
 * @returns true for a host element name.
 */
function isHostOpeningElementName(nameNode: OxcNode): boolean {
    return (
        nameNode.type === 'JSXIdentifier' &&
        /^[a-z]/.test(String((nameNode as unknown as { name: string }).name))
    );
}

/**
 * The shared unsupported-szs diagnostic — the exact contract (identifier keys,
 * pure-literal object or class-string values) is enforced identically by all
 * three engines so their outputs stay in parity.
 *
 * @param filename Source filename for context.
 * @returns The diagnostic message.
 */
function szsUnsupportedMessage(filename: string): string {
    return (
        `[csszyx] szs at ${filename}: ` +
        'every slot must be an identifier key with a static object literal ' +
        '(or class string) value. Attribute left unchanged.'
    );
}

/**
 * Whether a value is allowed inside an szs slot object: string / number /
 * boolean literals, a negated number, or a nested object of the same.
 * Deliberately STRICTER than the sz path (no identifiers, spreads,
 * conditionals, parens, or `as` casts) so all three engines can enforce the
 * exact same contract without a scope resolver.
 *
 * @param node The candidate value node.
 * @returns true when the value is a pure literal.
 */
function isPureLiteralSzValue(node: OxcNode): boolean {
    if (node.type === 'Literal') {
        const value = (node as unknown as { value: unknown }).value;
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    }
    if (node.type === 'UnaryExpression') {
        const unary = node as unknown as { operator: string; argument: OxcNode };
        return (
            unary.operator === '-' &&
            unary.argument.type === 'Literal' &&
            typeof (unary.argument as unknown as { value: unknown }).value === 'number'
        );
    }
    if (node.type === 'ObjectExpression') {
        const properties = (node as unknown as { properties: OxcNode[] }).properties;
        return properties.every(propRaw => {
            if (propRaw.type !== 'Property') {
                return false;
            }
            const prop = propRaw as PropertyNode;
            return (
                !prop.computed && prop.key.type === 'Identifier' && isPureLiteralSzValue(prop.value)
            );
        });
    }
    return false;
}

/**
 * Whether an szs value is a valid v1 slot map: every property is a
 * non-computed identifier-keyed Property whose value is a class string or a
 * pure-literal sz object.
 *
 * @param slotMap The szs object expression.
 * @returns true when every slot satisfies the v1 contract.
 */
function isValidSzsSlotMap(slotMap: ObjectExpressionNode): boolean {
    return slotMap.properties.every(propRaw => {
        if (propRaw.type !== 'Property') {
            return false;
        }
        const prop = propRaw as PropertyNode;
        if (prop.computed || prop.key.type !== 'Identifier') {
            return false;
        }
        const value = prop.value;
        if (
            value.type === 'Literal' &&
            typeof (value as unknown as { value: unknown }).value === 'string'
        ) {
            return true;
        }
        return value.type === 'ObjectExpression' && isPureLiteralSzValue(value);
    });
}

/**
 * Best-effort display name for an opening element:
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
    /** The sz key the value sits on — the runtime helper needs it for axis tokens. */
    szKey: string;
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
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
}

/** Ready-to-emit partial object transform fragments. */
interface OxcPartialTransform {
    className: string;
    classNameAttr: string;
    styleProps: string[];
    usesColorVar: boolean;
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
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
 * Resolve one supported identifier spread to its static sz object.
 *
 * @param spread Oxc spread node.
 * @param filename Filename used in unsupported-shape diagnostics.
 * @param bindings Static object bindings available at the call site.
 * @returns Resolved static sz object.
 */
function resolveSzObjectSpread(
    spread: SpreadElementNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
): SzObject {
    if (spread.argument.type === 'Identifier') {
        const bound = bindings.get(String((spread.argument as IdentifierNode).name));
        if (bound) {
            return astObjectToSzObject(bound, filename, bindings);
        }
    }
    throw new OxcNotImplementedError(
        'D5',
        `unsupported object spread in sz object at ${filename}:${spread.start}`,
    );
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
 * @param branchPick When set, a nested conditional value resolves to this branch.
 * @returns Plain JS object with literal values.
 */
function astObjectToSzObject(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    branchPick?: 'consequent' | 'alternate',
): SzObject {
    const result: Record<string, SzValue> = {};
    for (const propRaw of node.properties) {
        if (propRaw.type === 'SpreadElement') {
            Object.assign(
                result,
                resolveSzObjectSpread(propRaw as SpreadElementNode, filename, bindings),
            );
            continue;
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
        result[key] = astValueToSzValue(prop.value, filename, bindings, branchPick);
    }
    return result as SzObject;
}

/** Result of classifying an sz array for later-wins composition. */
type ArrayComposition =
    | {
          /** Every element was a static object: deep-merged and compiled at build. */
          kind: 'static';
          /** Class tokens of the merged object. */
          classes: string[];
      }
    | {
          /** Runtime group-merge required: emit `szcn(<args>)`. */
          kind: 'szcn';
          /** Comma-joined `szcn` argument source text. */
          args: string;
          /** Whether any argument wraps a dynamic element in `_szPart`. */
          usesSzPart: boolean;
      };

/** Shared inputs used while classifying one sz array expression. */
interface ArrayCompositionContext {
    filename: string;
    bindings: ReadonlyMap<string, ObjectExpressionNode>;
    globalVarAliases: ReadonlyMap<string, string>;
    cssVariableMap: Map<string, CssVariableMangleValue>;
    source: string;
    classes: Set<string>;
    diagnostics: string[];
}

/** One classified element of an sz array expression. */
type ArrayCompositionPart =
    | { kind: 'obj'; sz: SzObject }
    | { kind: 'str'; value: string }
    | { kind: 'cond'; condSource: string; classNames: string }
    | { kind: 'dyn'; src: string; node: OxcNode };

/**
 * Classify an sz array (`sz={[a, b, …]}`) for later-wins composition.
 *
 * All-static-object arrays deep-merge at build time (later element's leaf
 * wins per key path, sibling keys survive) and compile to plain classes.
 * Anything else — class strings, `cond && obj` guards, dynamic expressions —
 * becomes a `szcn(...)` call: static parts pre-compiled to string literals,
 * conditional parts kept as `cond && "classes"`, dynamic parts wrapped in
 * `_szPart(expr)` so a runtime sz object still compiles and a forwarded slot
 * string passes through. `szcn` then applies the same later-wins semantics
 * per property group. Element order is preserved in both lanes.
 *
 * @param node Array expression used as the sz value.
 * @param context Shared bindings, aliases, source, and output sinks.
 * @returns The composition, or null when the whole array must stay a runtime
 *   value (a spread element).
 */
function buildArrayComposition(
    node: ArrayExpressionNode,
    context: ArrayCompositionContext,
): ArrayComposition | null {
    const parts: ArrayCompositionPart[] = [];
    for (const element of node.elements) {
        if (!element || isFalsyLiteral(element)) {
            continue;
        }
        if (element.type === 'SpreadElement') {
            return null;
        }
        const part = classifyArrayCompositionElement(element, context);
        if (part) parts.push(part);
    }

    return parts.every(isStaticArrayCompositionPart)
        ? buildStaticArrayComposition(parts, context)
        : buildRuntimeArrayComposition(parts, context);
}

/**
 * Classifies one non-spread array element.
 *
 * @param element - Array element to classify.
 * @param context - Shared transform state.
 * @returns Classified part, or undefined when the element can be omitted.
 */
function classifyArrayCompositionElement(
    element: OxcNode,
    context: ArrayCompositionContext,
): ArrayCompositionPart | undefined {
    const unwrapped = unwrapExpression(element);
    if (isFalsyOrUndefinedExpression(unwrapped)) return undefined;

    const literalValue = literalNodeValue(unwrapped);
    if (typeof literalValue === 'string') return { kind: 'str', value: literalValue };

    if (
        unwrapped.type === 'LogicalExpression' &&
        (unwrapped as LogicalExpressionNode).operator === '&&'
    ) {
        return classifyLogicalArrayPart(element, unwrapped as LogicalExpressionNode, context);
    }

    const objectNode = resolveObjectExpression(unwrapped, context.bindings);
    const sz = objectNode ? tryConvertArrayObject(objectNode, context) : null;
    return sz
        ? { kind: 'obj', sz }
        : { kind: 'dyn', src: context.source.slice(element.start, element.end), node: element };
}

/**
 * Returns whether an expression is a skipped falsy/undefined array value.
 *
 * @param node - Expression to inspect.
 * @returns Whether the expression contributes no runtime class value.
 */
function isFalsyOrUndefinedExpression(node: OxcNode): boolean {
    return (
        isFalsyLiteral(node) ||
        (node.type === 'Identifier' && String((node as IdentifierNode).name) === 'undefined')
    );
}

/**
 * Reads an Oxc literal value without treating other node shapes as literals.
 *
 * @param node - Expression to inspect.
 * @returns Literal value, or undefined for a non-literal expression.
 */
function literalNodeValue(node: OxcNode): unknown {
    return node.type === 'Literal' ? (node as unknown as { value: unknown }).value : undefined;
}

/**
 * Classifies a guarded `condition && value` array element.
 *
 * @param element - Complete guarded element used for runtime fallback source.
 * @param logical - Unwrapped logical expression.
 * @param context - Shared transform state.
 * @returns Classified conditional or dynamic part, or undefined for an empty value.
 */
function classifyLogicalArrayPart(
    element: OxcNode,
    logical: LogicalExpressionNode,
    context: ArrayCompositionContext,
): ArrayCompositionPart | undefined {
    const right = unwrapExpression(logical.right);
    const literalValue = literalNodeValue(right);
    let classNames = typeof literalValue === 'string' ? literalValue : null;
    if (classNames === null) {
        const objectNode = resolveObjectExpression(right, context.bindings);
        const sz = objectNode ? tryConvertArrayObject(objectNode, context) : null;
        if (sz) classNames = compileArrayCompositionPart(sz, context);
    }

    if (classNames === '') return undefined;
    if (classNames !== null) {
        return {
            kind: 'cond',
            condSource: context.source.slice(logical.left.start, logical.left.end),
            classNames,
        };
    }
    return { kind: 'dyn', src: context.source.slice(element.start, element.end), node: element };
}

/**
 * Converts a resolvable object while treating unsupported Oxc shapes as dynamic.
 *
 * @param objectNode - Resolved object expression.
 * @param context - Shared transform state.
 * @returns Static sz object, or null when runtime evaluation is required.
 */
function tryConvertArrayObject(
    objectNode: ObjectExpressionNode,
    context: ArrayCompositionContext,
): SzObject | null {
    try {
        return astObjectToSzObject(objectNode, context.filename, context.bindings);
    } catch (error) {
        if (error instanceof OxcNotImplementedError) return null;
        throw error;
    }
}

/**
 * Compiles one static array part with global variable aliases applied.
 *
 * @param sz - Static sz object.
 * @param context - Shared transform state.
 * @returns Space-delimited compiled classes.
 */
function compileArrayCompositionPart(sz: SzObject, context: ArrayCompositionContext): string {
    return compileSzObject(
        applyGlobalVarAliasesToSzObject(sz, context.globalVarAliases, context.cssVariableMap),
    ).className;
}

/**
 * Type guard for the all-static array lane.
 *
 * @param part - Classified array part.
 * @returns Whether the part is a static sz object.
 */
function isStaticArrayCompositionPart(
    part: ArrayCompositionPart,
): part is Extract<ArrayCompositionPart, { kind: 'obj' }> {
    return part.kind === 'obj';
}

/**
 * Deep-merges and compiles an all-static array composition.
 *
 * @param parts - Static object parts in authored order.
 * @param context - Shared transform state.
 * @returns Static array composition with later-wins semantics.
 */
function buildStaticArrayComposition(
    parts: Array<Extract<ArrayCompositionPart, { kind: 'obj' }>>,
    context: ArrayCompositionContext,
): ArrayComposition {
    const merged = parts.reduce<SzObject>(
        (accumulator, part) => deepMergeSzObjects(accumulator, part.sz),
        {},
    );
    const staticClasses = collectArrayCompositionClasses(
        compileArrayCompositionPart(merged, context),
        context.classes,
    );
    return { kind: 'static', classes: staticClasses };
}

/**
 * Emits runtime `szcn` arguments for a mixed array composition.
 *
 * @param parts - Classified parts in authored order.
 * @param context - Shared transform state.
 * @returns Runtime composition and helper requirements.
 */
function buildRuntimeArrayComposition(
    parts: ArrayCompositionPart[],
    context: ArrayCompositionContext,
): ArrayComposition {
    const args: string[] = [];
    let usesSzPart = false;
    for (const part of parts) {
        if (appendRuntimeArrayPart(part, args, context)) usesSzPart = true;
    }
    return { kind: 'szcn', args: args.join(', '), usesSzPart };
}

/**
 * Appends one runtime array argument and reports whether `_szPart` is required.
 *
 * @param part - Classified part to emit.
 * @param args - Mutable runtime argument list.
 * @param context - Shared transform state.
 * @returns Whether the emitted argument requires `_szPart`.
 */
function appendRuntimeArrayPart(
    part: ArrayCompositionPart,
    args: string[],
    context: ArrayCompositionContext,
): boolean {
    if (part.kind === 'obj') {
        const compiled = compileArrayCompositionPart(part.sz, context);
        collectArrayCompositionClasses(compiled, context.classes);
        args.push(JSON.stringify(compiled));
        return false;
    }
    if (part.kind === 'str') {
        collectArrayCompositionClasses(part.value, context.classes);
        args.push(JSON.stringify(part.value));
        return false;
    }
    if (part.kind === 'cond') {
        collectArrayCompositionClasses(part.classNames, context.classes);
        args.push(`${part.condSource} && ${JSON.stringify(part.classNames)}`);
        return false;
    }

    collectCandidateClassesFromExpression(
        part.node,
        context.filename,
        context.bindings,
        context.classes,
        '',
    );
    if (unwrapExpression(part.node).type === 'ObjectExpression') {
        context.diagnostics.push(buildSzPartElementDiagnostic(part.node, context.source));
    }
    args.push(`_szPart(${part.src})`);
    return true;
}

/**
 * Adds whitespace-delimited class tokens to the shared set and returns them.
 *
 * @param value - Space-delimited class string.
 * @param classes - Shared generated-class set.
 * @returns Non-empty class tokens in source order.
 */
function collectArrayCompositionClasses(value: string, classes: Set<string>): string[] {
    const collected: string[] = [];
    for (const className of value.split(/\s+/)) {
        if (!className) continue;
        collected.push(className);
        classes.add(className);
    }
    return collected;
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
    const context: CandidateClassContext = { filename, bindings, classes, variantPrefix };
    collectCandidateObject(node, context);
}

/** Shared state for best-effort candidate collection. */
interface CandidateClassContext {
    filename: string;
    bindings: ReadonlyMap<string, ObjectExpressionNode>;
    classes: Set<string>;
    variantPrefix: string;
}

/**
 * Collects one object as a whole, falling back to property-level discovery.
 *
 * @param node Object expression to inspect.
 * @param context Candidate collection state.
 */
function collectCandidateObject(node: ObjectExpressionNode, context: CandidateClassContext): void {
    if (tryCollectWholeCandidateObject(node, context)) return;
    for (const property of node.properties) {
        if (property.type === 'SpreadElement') {
            collectCandidateSpread(property as SpreadElementNode, context);
        } else if (property.type === 'Property') {
            collectCandidateProperty(property as PropertyNode, context);
        }
    }
}

/**
 * Attempts to compile one candidate object without partial fallback.
 *
 * @param node Object expression to compile.
 * @param context Candidate collection state.
 * @returns Whether whole-object compilation succeeded.
 */
function tryCollectWholeCandidateObject(
    node: ObjectExpressionNode,
    context: CandidateClassContext,
): boolean {
    try {
        const object = astObjectToSzObject(node, context.filename, context.bindings);
        addPrefixedCandidateClasses(compileSzObject(object).className, context);
        return true;
    } catch (error) {
        if (error instanceof OxcNotImplementedError) return false;
        throw error;
    }
}

/**
 * Collects a spread candidate from a bound object or dynamic expression.
 *
 * @param spread Spread element.
 * @param context Candidate collection state.
 */
function collectCandidateSpread(spread: SpreadElementNode, context: CandidateClassContext): void {
    const argument = unwrapExpression(spread.argument);
    if (argument.type === 'Identifier') {
        const bound = context.bindings.get(String((argument as IdentifierNode).name));
        if (bound) collectCandidateObject(bound, context);
        return;
    }
    collectCandidateExpression(spread.argument, context);
}

/**
 * Collects candidates from one static-key property.
 *
 * @param property Object property.
 * @param context Candidate collection state.
 */
function collectCandidateProperty(property: PropertyNode, context: CandidateClassContext): void {
    if (property.computed) return;
    const key = extractKeyName(property.key);
    if (key === null) return;
    const value = unwrapExpression(property.value);
    if (value.type === 'ObjectExpression') {
        collectCandidateObjectProperty(key, value as ObjectExpressionNode, context);
    } else if (value.type === 'ConditionalExpression') {
        collectCandidateConditionalProperty(key, value as ConditionalExpressionNode, context);
    } else {
        collectCandidateValueProperty(key, value, context);
    }
}

/**
 * Collects an object-valued property, preserving nested variant prefixes.
 *
 * @param key Property key.
 * @param value Object value.
 * @param context Candidate collection state.
 */
function collectCandidateObjectProperty(
    key: string,
    value: ObjectExpressionNode,
    context: CandidateClassContext,
): void {
    if (isKnownVariant(key)) {
        const variantPrefix = context.variantPrefix ? `${context.variantPrefix}:${key}` : key;
        collectCandidateObject(value, { ...context, variantPrefix });
        return;
    }
    try {
        const propertyValue = astObjectToSzObject(value, context.filename, context.bindings);
        addPrefixedCandidateClasses(compileSzObject({ [key]: propertyValue }).className, context);
    } catch {
        collectCandidateExpression(value, context);
    }
}

/**
 * Collects both branches of a conditional property.
 *
 * @param key Property key.
 * @param conditional Conditional value.
 * @param context Candidate collection state.
 */
function collectCandidateConditionalProperty(
    key: string,
    conditional: ConditionalExpressionNode,
    context: CandidateClassContext,
): void {
    collectCandidateValueProperty(key, conditional.consequent, context);
    collectCandidateValueProperty(key, conditional.alternate, context);
}

/**
 * Compiles one property value or falls back to expression discovery.
 *
 * @param key Property key.
 * @param value Property value.
 * @param context Candidate collection state.
 */
function collectCandidateValueProperty(
    key: string,
    value: OxcNode,
    context: CandidateClassContext,
): void {
    try {
        const propertyValue = astValueToSzValue(value, context.filename, context.bindings);
        addPrefixedCandidateClasses(compileSzObject({ [key]: propertyValue }).className, context);
    } catch {
        collectCandidateExpression(value, context);
    }
}

/**
 * Delegates expression discovery with the current candidate context.
 *
 * @param value Expression to inspect.
 * @param context Candidate collection state.
 */
function collectCandidateExpression(value: OxcNode, context: CandidateClassContext): void {
    collectCandidateClassesFromExpression(
        value,
        context.filename,
        context.bindings,
        context.classes,
        context.variantPrefix,
    );
}

/**
 * Adds compiled classes after applying the current variant prefix.
 *
 * @param className Compiled class string.
 * @param context Candidate collection state.
 */
function addPrefixedCandidateClasses(className: string, context: CandidateClassContext): void {
    const prefixed = prefixVariantClasses(className, context.variantPrefix);
    for (const candidate of prefixed.split(/\s+/)) {
        if (candidate) context.classes.add(candidate);
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
    if (node.callee.type !== 'Identifier') {
        return;
    }
    const calleeName = (node.callee as IdentifierNode).name;
    // szr(static-object) resolves the same classes at runtime that dynamic()
    // would inject; both need their literal args safelisted at build time.
    if (calleeName !== 'dynamic' && calleeName !== 'szr') {
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
 * @param bindings Local object-literal bindings.
 * @param constInits Const-only initializer map for per-key leaf resolution.
 * @param classes Class set to populate.
 */
function collectSzvCallClasses(
    node: CallExpressionNode,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    constInits: ReadonlyMap<string, OxcNode>,
    classes: Set<string>,
): void {
    if (node.callee.type !== 'Identifier' || (node.callee as IdentifierNode).name !== 'szv') {
        return;
    }
    const [firstArg] = node.arguments;
    if (!firstArg) {
        return;
    }
    const configNode = resolveObjectExpression(firstArg, bindings);
    if (!configNode) {
        return;
    }

    // Read `base` and `variants` INDEPENDENTLY, and convert both PER KEY: one
    // unresolvable leaf (a runtime conditional, a call, a template) used to
    // drop the ENTIRE catalog — every static sibling key and every other
    // variant included — which under Tailwind `source(none)` is silently
    // missing CSS. The lenient walk keeps everything it can classify, expands
    // finite conditionals into both branches (the runtime picks one, so both
    // must be safelisted), and skips only what it genuinely cannot read.
    const budget: CatalogExtrasBudget = {
        extras: MAX_CATALOG_BRANCH_EXTRAS,
        explores: MAX_CATALOG_BRANCH_EXTRAS,
        objectMemo: new Map(),
        valueMemo: new Map(),
    };
    const baseNode = readConfigSubObjectNode(configNode, 'base', bindings);
    const baseCandidates = baseNode
        ? lenientCatalogObjects(baseNode, constInits, new Set(), 0, budget)
        : [{} as SzObject];
    const base = baseCandidates[0] ?? ({} as SzObject);
    addCompiledClasses(base, classes);
    for (const extra of baseCandidates.slice(1)) {
        addCompiledClasses(extra, classes);
    }

    const variantsNode = readConfigSubObjectNode(configNode, 'variants', bindings);
    if (!variantsNode) return;
    for (const dimensionRaw of variantsNode.properties) {
        collectSzvDimensionClasses(dimensionRaw, base, constInits, budget, classes);
    }
}

/**
 * Collect all statically reachable classes from one szv variant dimension.
 * @param dimensionRaw - Dimension property to inspect.
 * @param base - Base style merged into each candidate.
 * @param constInits - Const initializer lookup.
 * @param budget - Alternate-branch budget and memo.
 * @param classes - Class catalog to populate.
 */
function collectSzvDimensionClasses(
    dimensionRaw: ObjectExpressionNode['properties'][number],
    base: SzObject,
    constInits: ReadonlyMap<string, OxcNode>,
    budget: CatalogExtrasBudget,
    classes: Set<string>,
): void {
    if (dimensionRaw.type !== 'Property') return;
    const dimension = dimensionRaw as PropertyNode;
    if (dimension.computed) return;
    const value = resolveCatalogObjectExpression(dimension.value, constInits, new Set());
    if (!value) return;
    for (const variantRaw of value.properties) {
        if (variantRaw.type !== 'Property') continue;
        const variant = variantRaw as PropertyNode;
        if (variant.computed) continue;
        for (const candidate of lenientCatalogObjectCandidates(
            variant.value,
            constInits,
            new Set(),
            0,
            budget,
        )) {
            addCompiledClasses({ ...base, ...candidate }, classes);
        }
    }
}

/**
 * Read a single named property (`base` / `variants`) of an szv config as an
 * OBJECT NODE, without converting it. Returns null when the key is absent or
 * its value is not an object literal / const-bound object — so sibling keys
 * (compoundVariants, defaultVariants, unknown keys) never affect the catalog.
 *
 * @param configNode The szv config object node.
 * @param key The property to read.
 * @param bindings Local const-binding map for indirection.
 * @returns The sub-object node, or null.
 */
function readConfigSubObjectNode(
    configNode: ObjectExpressionNode,
    key: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
): ObjectExpressionNode | null {
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
        return resolveObjectExpression(prop.value, bindings);
    }
    return null;
}

/** Nesting cap for the lenient catalog walk (matches the Rust/Babel walkers). */
const MAX_CATALOG_DEPTH = 16;

/**
 * Cap on alternate-branch objects one szv call may add to the catalog, so a
 * pathological conditional pile-up cannot balloon the safelist walk.
 * (Matches the Rust/Babel walkers.)
 */
const MAX_CATALOG_BRANCH_EXTRAS = 32;

/** Mutable extras budget threaded through one szv call's lenient walk. */
interface CatalogExtrasBudget {
    /** Remaining alternate-branch objects this call may still emit. */
    extras: number;
    /**
     * Remaining alternate branches this call may still EXPLORE. Charged when a
     * conditional's alternate is recursed into, not when its result is
     * emitted: a const referenced from both branches (`c ? x : x`) doubles the
     * walk per level without consuming depth or emitting anything, so an
     * output-only budget let an n-level chain run 2^n recursive calls (a
     * measured exponential hang). Exhausted explores degrade to
     * consequent-only — the same under-safelist-beyond-the-budget contract
     * `extras` already documents. (Matches the Rust walker.)
     */
    explores: number;
    /**
     * Candidate memo per resolved const INITIALIZER node. Every exponential
     * shape is some DAG that re-resolves the same initializer — through
     * conditionals (`c ? x : x`), spreads (`{...x, ...x}`), or sibling keys
     * (`{a: x, b: x}`) — and the memo collapses each to one walk plus cache
     * hits, keeping total work linear in the source. Keyed by node identity;
     * inline literals cannot exponentiate on their own (each occupies
     * distinct source text).
     */
    objectMemo: Map<OxcNode, SzObject[]>;
    valueMemo: Map<OxcNode, SzValue[]>;
}

/**
 * Convert an object node into catalog candidates, PER KEY: index 0 is the
 * primary object (conditionals resolved to their consequent), the rest are
 * minimal path-preserving objects carrying alternate branch values (e.g.
 * `{ hover: { mx: dense ? 0 : 2 } }` → `[{hover:{mx:0}}, {hover:{mx:2}}]`).
 * Keys whose value cannot be classified are skipped INDIVIDUALLY — sz keys
 * lower independently, so sibling classes survive. Catalog-only: the strict
 * sz-attribute conversion keeps its fall-to-runtime contract.
 *
 * @param node Object expression to walk.
 * @param constInits Const-only initializer map for identifier resolution.
 * @param seen Identifier names already followed (cycle guard).
 * @param depth Current nesting depth.
 * @param budget Remaining alternate-branch allowance for this szv call.
 * @returns Candidate objects; `[{}]`-like primary always present.
 */
function lenientCatalogObjects(
    node: ObjectExpressionNode,
    constInits: ReadonlyMap<string, OxcNode>,
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzObject[] {
    if (depth > MAX_CATALOG_DEPTH) {
        return [{} as SzObject];
    }
    const primary: Record<string, SzValue> = {};
    const extras: SzObject[] = [];
    for (const propRaw of node.properties) {
        collectLenientCatalogProperty(propRaw, primary, extras, constInits, seen, depth, budget);
    }
    return [primary as SzObject, ...extras];
}

/**
 * Add one object property or spread to the lenient catalog candidates.
 * @param propRaw - Property or spread to collect.
 * @param primary - Primary catalog object being built.
 * @param extras - Alternate catalog objects being built.
 * @param constInits - Const initializer lookup.
 * @param seen - Identifier cycle guard.
 * @param depth - Current catalog depth.
 * @param budget - Alternate-branch budget.
 */
function collectLenientCatalogProperty(
    propRaw: ObjectExpressionNode['properties'][number],
    primary: Record<string, SzValue>,
    extras: SzObject[],
    constInits: ReadonlyMap<string, OxcNode>,
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): void {
    if (propRaw.type === 'SpreadElement') {
        const candidates = lenientCatalogObjectCandidates(
            (propRaw as SpreadElementNode).argument,
            constInits,
            seen,
            depth + 1,
            budget,
        );
        const [first, ...rest] = candidates;
        if (first) Object.assign(primary, first);
        for (const extra of rest) pushCatalogExtra(extras, extra, budget);
        return;
    }
    if (propRaw.type !== 'Property') return;
    const prop = propRaw as PropertyNode;
    if (prop.computed) return;
    const key = extractKeyName(prop.key);
    if (key === null) return;
    const values = lenientCatalogValues(prop.value, constInits, seen, depth + 1, budget);
    const [firstValue, ...restValues] = values;
    if (firstValue === undefined) return;
    primary[key] = firstValue;
    for (const value of restValues) {
        pushCatalogExtra(extras, { [key]: value } as SzObject, budget);
    }
}

/**
 * Classify one leaf value into catalog candidates. Empty result = skip the
 * key. Finite conditionals contribute BOTH branches (the runtime resolves one
 * of them, so both classes must exist); `null`/`undefined` mean "key unset";
 * const identifiers resolve through their initializer (const-only, cycle
 * guarded); everything else — calls, members, templates — is skipped.
 *
 * @param node Value node to classify.
 * @param constInits Const-only initializer map for identifier resolution.
 * @param seen Identifier names already followed (cycle guard).
 * @param depth Current nesting depth.
 * @param budget Remaining alternate-branch allowance for this szv call.
 * @returns Candidate values in branch order (consequent first).
 */
function lenientCatalogValues(
    node: OxcNode,
    constInits: ReadonlyMap<string, OxcNode>,
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzValue[] {
    if (depth > MAX_CATALOG_DEPTH) {
        return [];
    }
    const unwrapped = unwrapExpression(node);
    const literal = oxcCatalogLiteralValues(unwrapped);
    if (literal !== null) return literal;
    if (unwrapped.type === 'ObjectExpression') {
        return lenientCatalogObjects(
            unwrapped as ObjectExpressionNode,
            constInits,
            seen,
            depth,
            budget,
        );
    }
    if (unwrapped.type === 'ConditionalExpression') {
        return oxcCatalogConditionalValues(unwrapped, constInits, seen, depth, budget);
    }
    if (unwrapped.type === 'Identifier') {
        return oxcCatalogIdentifierValues(unwrapped, constInits, seen, depth, budget);
    }
    return [];
}

/**
 * Classify OXC primitive and signed numeric catalog values.
 * @param node - OXC node to classify.
 * @returns Candidate values, or null when this helper does not own the shape.
 */
function oxcCatalogLiteralValues(node: OxcNode): SzValue[] | null {
    if (node.type === 'Literal') {
        const value = (node as unknown as { value: unknown }).value;
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? [value]
            : [];
    }
    if (node.type !== 'UnaryExpression') return null;
    const unary = node as unknown as { operator: string; argument: OxcNode };
    if ((unary.operator !== '-' && unary.operator !== '+') || unary.argument.type !== 'Literal') {
        return [];
    }
    const value = (unary.argument as unknown as { value: unknown }).value;
    if (typeof value !== 'number') return [];
    return [unary.operator === '-' ? -value : value];
}

/**
 * Explore the bounded branches of one OXC catalog conditional.
 * @param node - Conditional node to explore.
 * @param constInits - Const initializer lookup.
 * @param seen - Identifier cycle guard.
 * @param depth - Current catalog depth.
 * @param budget - Alternate-branch budget and memo.
 * @returns Bounded branch values in source order.
 */
function oxcCatalogConditionalValues(
    node: OxcNode,
    constInits: ReadonlyMap<string, OxcNode>,
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzValue[] {
    const conditional = node as ConditionalExpressionNode;
    const values = lenientCatalogValues(conditional.consequent, constInits, seen, depth, budget);
    if (budget.explores > 0) {
        budget.explores -= 1;
        values.push(
            ...lenientCatalogValues(conditional.alternate, constInits, seen, depth, budget),
        );
    }
    return truncateCatalogCandidates(values, budget);
}

/**
 * Resolve one OXC const identifier through the bounded catalog memo.
 * @param node - Identifier node to resolve.
 * @param constInits - Const initializer lookup.
 * @param seen - Identifier cycle guard.
 * @param depth - Current catalog depth.
 * @param budget - Alternate-branch budget and memo.
 * @returns Memoized candidate values.
 */
function oxcCatalogIdentifierValues(
    node: OxcNode,
    constInits: ReadonlyMap<string, OxcNode>,
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzValue[] {
    const name = String((node as IdentifierNode).name);
    if (name === 'undefined' || seen.has(name)) return [];
    const initializer = constInits.get(name);
    if (!initializer) return [];
    const cached = budget.valueMemo.get(initializer);
    if (cached) return [...cached];
    const values = lenientCatalogValues(
        initializer,
        constInits,
        new Set([...seen, name]),
        depth,
        budget,
    );
    budget.valueMemo.set(initializer, values);
    return [...values];
}

/**
 * Resolve a node position that must yield OBJECT candidates (a variant value,
 * a spread argument): object literals, const-bound identifiers, and finite
 * conditionals between such objects.
 *
 * @param node Node to resolve.
 * @param constInits Const-only initializer map for identifier resolution.
 * @param seen Identifier names already followed (cycle guard).
 * @param depth Current nesting depth.
 * @param budget Remaining alternate-branch allowance for this szv call.
 * @returns Candidate objects; empty when the position is not object-like.
 */
function lenientCatalogObjectCandidates(
    node: OxcNode,
    constInits: ReadonlyMap<string, OxcNode>,
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzObject[] {
    if (depth > MAX_CATALOG_DEPTH) {
        return [];
    }
    const unwrapped = unwrapExpression(node);
    if (unwrapped.type === 'ObjectExpression') {
        return lenientCatalogObjects(
            unwrapped as ObjectExpressionNode,
            constInits,
            seen,
            depth,
            budget,
        );
    }
    if (unwrapped.type === 'ConditionalExpression') {
        const conditional = unwrapped as ConditionalExpressionNode;
        const candidates = lenientCatalogObjectCandidates(
            conditional.consequent,
            constInits,
            seen,
            depth,
            budget,
        );
        // The alternate is a paid exploration (see `explores`); once the
        // allowance is spent every further conditional degrades to its
        // consequent, keeping the recursion tree linear in the source.
        if (budget.explores > 0) {
            budget.explores -= 1;
            candidates.push(
                ...lenientCatalogObjectCandidates(
                    conditional.alternate,
                    constInits,
                    seen,
                    depth,
                    budget,
                ),
            );
        }
        return truncateCatalogCandidates(candidates, budget);
    }
    if (unwrapped.type === 'Identifier') {
        const name = String((unwrapped as IdentifierNode).name);
        const init = constInits.get(name);
        if (!init || seen.has(name)) {
            return [];
        }
        const cached = budget.objectMemo.get(init);
        if (cached) {
            return [...cached];
        }
        const candidates = lenientCatalogObjectCandidates(
            init,
            constInits,
            new Set([...seen, name]),
            depth,
            budget,
        );
        budget.objectMemo.set(init, candidates);
        return [...candidates];
    }
    return [];
}

/**
 * Bound a candidate list to what can still be consumed: one primary plus the
 * remaining alternate-branch budget — the guard that keeps branch fan-out
 * linear in the source.
 *
 * @param candidates Candidate list to bound (mutated in place).
 * @param budget Remaining alternate-branch allowance for this szv call.
 * @returns The bounded list.
 */
function truncateCatalogCandidates<T>(candidates: T[], budget: CatalogExtrasBudget): T[] {
    const cap = budget.extras + 1;
    if (candidates.length > cap) {
        candidates.length = cap;
    }
    return candidates;
}

/**
 * Resolve a node to an object expression through the const-initializer map
 * (used for variant DIMENSION values, which cannot fork into candidates).
 *
 * @param node Node to resolve.
 * @param constInits Const-only initializer map for identifier resolution.
 * @param seen Identifier names already followed (cycle guard).
 * @returns Object expression, or null.
 */
function resolveCatalogObjectExpression(
    node: OxcNode,
    constInits: ReadonlyMap<string, OxcNode>,
    seen: ReadonlySet<string>,
): ObjectExpressionNode | null {
    const unwrapped = unwrapExpression(node);
    if (unwrapped.type === 'ObjectExpression') {
        return unwrapped as ObjectExpressionNode;
    }
    if (unwrapped.type === 'Identifier') {
        const name = String((unwrapped as IdentifierNode).name);
        const init = constInits.get(name);
        if (!init || seen.has(name)) {
            return null;
        }
        return resolveCatalogObjectExpression(init, constInits, new Set([...seen, name]));
    }
    return null;
}

/**
 * Append an alternate-branch object to the extras list within budget.
 *
 * @param extras Extras collected so far.
 * @param extra Path-preserving alternate object.
 * @param budget Remaining alternate-branch allowance for this szv call.
 */
function pushCatalogExtra(extras: SzObject[], extra: SzObject, budget: CatalogExtrasBudget): void {
    if (budget.extras <= 0) {
        return;
    }
    budget.extras -= 1;
    extras.push(extra);
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
 * Total ConditionalExpression values (recursing into sub-objects) in an oxc object.
 * @param node Object expression to scan.
 * @returns the count.
 */
function countOxcConditionals(node: ObjectExpressionNode): number {
    let count = 0;
    for (const propRaw of node.properties) {
        if (propRaw.type !== 'Property') {
            continue;
        }
        const value = (propRaw as PropertyNode).value;
        if (value.type === 'ConditionalExpression') {
            count++;
        } else if (value.type === 'ObjectExpression') {
            count += countOxcConditionals(value as ObjectExpressionNode);
        }
    }
    return count;
}

/**
 * The first ConditionalExpression value anywhere in the tree, or null.
 * @param node Object expression to scan.
 * @returns the first nested conditional node, or null.
 */
function firstOxcConditional(node: ObjectExpressionNode): ConditionalExpressionNode | null {
    for (const propRaw of node.properties) {
        if (propRaw.type !== 'Property') {
            continue;
        }
        const value = (propRaw as PropertyNode).value;
        if (value.type === 'ConditionalExpression') {
            return value as ConditionalExpressionNode;
        }
        if (value.type === 'ObjectExpression') {
            const found = firstOxcConditional(value as ObjectExpressionNode);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

/**
 * Hoist a single finite conditional nested in a sub-object value
 * (`{ borderColor: { color: cond ? 'red-700' : 'charcoal', op: 18 } }`) into a
 * class-level ternary, matching the native engine. A top-level conditional prop is
 * left to the partial path; more than one nested conditional returns null.
 *
 * @param node Object expression used as the sz value.
 * @param filename Filename for diagnostics.
 * @param bindings Local object-literal bindings.
 * @param source Original source for test expression slicing.
 * @param classes Class set to populate with both branches' classes.
 * @param globalVarAliases Exact global custom-property alias table.
 * @param cssVariableMap CSS variable metadata map to populate.
 * @returns Ternary className expression source, or null when unsupported.
 */
function buildNestedConditionalClassExpression(
    node: ObjectExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    source: string,
    classes: Set<string>,
    globalVarAliases: ReadonlyMap<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue>,
): string | null {
    // A direct top-level conditional prop is handled (factored) by the partial
    // path; only hoist when the single conditional lives inside a sub-object.
    let topLevel = 0;
    for (const propRaw of node.properties) {
        if (
            propRaw.type === 'Property' &&
            (propRaw as PropertyNode).value.type === 'ConditionalExpression'
        ) {
            topLevel++;
        }
    }
    const first = firstOxcConditional(node);
    if (topLevel !== 0 || countOxcConditionals(node) !== 1 || !first) {
        return null;
    }

    // Match the native engine's factored shape: the non-conditional props emit
    // once as a static prefix, and only the conditional prop varies inside the
    // ternary — `bg-white/70 ${cond ? "border-red-700/18" : "border-charcoal/18"}`.
    // Repeating the static classes in both branches (the previous shape) produced
    // the same class SET but a different discovery ORDER than Rust, so production
    // mangle IDs — assigned in discovery order — diverged between engines.
    const condPropIndex = node.properties.findIndex(
        prop =>
            prop.type === 'Property' &&
            (prop as PropertyNode).value.type === 'ObjectExpression' &&
            countOxcConditionals((prop as PropertyNode).value as ObjectExpressionNode) === 1,
    );
    if (condPropIndex === -1) {
        return null;
    }
    const staticNode: ObjectExpressionNode = {
        ...node,
        properties: node.properties.filter((_, i) => i !== condPropIndex),
    };
    const condNode: ObjectExpressionNode = {
        ...node,
        properties: [node.properties[condPropIndex]],
    };

    const compile = (
        target: ObjectExpressionNode,
        pick?: 'consequent' | 'alternate',
    ): string | null => {
        try {
            return compileSzObject(
                applyGlobalVarAliasesToSzObject(
                    astObjectToSzObject(target, filename, bindings, pick),
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
    };

    const staticClasses = staticNode.properties.length > 0 ? compile(staticNode) : '';
    const consequent = compile(condNode, 'consequent');
    const alternate = compile(condNode, 'alternate');
    if (staticClasses === null || consequent === null || alternate === null) {
        return null;
    }
    // Discovery order (Rust parity): static classes, then the consequent branch,
    // then the alternate branch.
    for (const cls of `${staticClasses} ${consequent} ${alternate}`.split(/\s+/)) {
        if (cls) {
            classes.add(cls);
        }
    }

    const testSource = source.slice(first.test.start, first.test.end);
    const branch = (cls: string): string => (cls === '' ? 'undefined' : JSON.stringify(cls));
    const ternary = `${testSource} ? ${branch(consequent)} : ${branch(alternate)}`;
    if (staticClasses === '') {
        return ternary;
    }
    return `\`${staticClasses} \${${ternary}}\``;
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
        usesSpacingVar: partial.usesSpacingVar,
        usesUnitVar: partial.usesUnitVar,
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

    collectOxcHoistCandidates(root, null, {
        nodes,
        candidates,
        filename,
        bindings,
        source,
    });
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

/** Shared traversal state for component-tier OXC hoist collection. */
interface OxcHoistCollectionContext {
    nodes: CSSVariableHoistNode[];
    candidates: OxcComponentHoistCandidate[];
    filename: string;
    bindings: ReadonlyMap<string, ObjectExpressionNode>;
    source: string;
}

/**
 * Visit ordinary AST children that are outside JSX host nodes.
 *
 * @param node Current AST node.
 * @param parentElementId Current JSX parent id.
 * @param context Shared hoist collection state.
 */
function collectOxcChildNodes(
    node: OxcNode,
    parentElementId: string | null,
    context: OxcHoistCollectionContext,
): void {
    for (const key of Object.keys(node)) {
        if (isAstMetadataKey(key)) {
            continue;
        }
        const child = (node as Record<string, unknown>)[key];
        const children = Array.isArray(child) ? child : [child];
        for (const item of children) {
            if (isOxcNode(item)) {
                collectOxcHoistCandidates(item, parentElementId, context);
            }
        }
    }
}

/**
 * Collects JSX host nodes and dynamic CSS-var candidates for component hoisting.
 *
 * @param node Current AST node.
 * @param parentElementId Current JSX parent id.
 * @param context Shared hoist collection state.
 */
function collectOxcHoistCandidates(
    node: OxcNode,
    parentElementId: string | null,
    context: OxcHoistCollectionContext,
): void {
    if (node.type === 'JSXElement') {
        const element = node as JsxElementNode;
        const opening = element.openingElement;
        const elementId = elementIdForOpening(opening);
        context.nodes.push({
            id: elementId,
            parentId: parentElementId,
            canHost: canHostHoistedStyleProps(opening),
        });
        collectOpeningHoistCandidates(
            opening,
            elementId,
            context.candidates,
            context.filename,
            context.bindings,
            context.source,
        );
        for (const child of element.children) {
            collectOxcHoistCandidates(child, elementId, context);
        }
        return;
    }

    if (node.type === 'JSXFragment') {
        const fragment = node as JsxFragmentNode;
        const elementId = `f${node.start}`;
        context.nodes.push({ id: elementId, parentId: parentElementId, canHost: false });
        for (const child of fragment.children) {
            collectOxcHoistCandidates(child, elementId, context);
        }
        return;
    }
    collectOxcChildNodes(node, parentElementId, context);
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
    const context: PartialObjectContext = {
        filename,
        bindings,
        source,
        globalVarAliases,
        cssVariableMap,
        variantChain,
    };
    const result = createPartialObjectResult();
    for (const property of node.properties) {
        if (!evaluatePartialProperty(property, context, result)) return null;
    }
    return result;
}

/** Shared inputs for partial Oxc object evaluation. */
interface PartialObjectContext {
    filename: string;
    bindings: ReadonlyMap<string, ObjectExpressionNode>;
    source: string;
    globalVarAliases: ReadonlyMap<string, string>;
    cssVariableMap: Map<string, CssVariableMangleValue> | undefined;
    variantChain: string;
}

/**
 * Creates an empty partial-evaluation result.
 *
 * @returns Neutral partial object result.
 */
function createPartialObjectResult(): OxcPartialObjectResult {
    return {
        staticProps: {},
        dynamicProps: new Map(),
        conditionalClasses: [],
        usesColorVar: false,
        usesSpacingVar: false,
        usesUnitVar: false,
    };
}

/**
 * Evaluates one object member into static, conditional, or dynamic output.
 *
 * @param property Raw object member.
 * @param context Shared evaluation inputs.
 * @param result Mutable partial result.
 * @returns Whether the member is supported.
 */
function evaluatePartialProperty(
    property: OxcNode,
    context: PartialObjectContext,
    result: OxcPartialObjectResult,
): boolean {
    if (property.type === 'SpreadElement') {
        return evaluatePartialSpread(property as SpreadElementNode, context, result);
    }
    if (property.type !== 'Property') return false;
    const objectProperty = property as PropertyNode;
    const key = objectProperty.computed ? null : extractKeyName(objectProperty.key);
    if (key === null) return false;

    const value = unwrapExpression(objectProperty.value);
    if (tryEvaluateStaticPartialProperty(key, value, context, result)) return true;
    if (value.type === 'ObjectExpression' && isKnownVariant(key)) {
        return evaluateNestedPartialVariant(key, value as ObjectExpressionNode, context, result);
    }
    if (
        value.type === 'ConditionalExpression' &&
        evaluatePartialConditional(key, value as ConditionalExpressionNode, context, result)
    ) {
        return true;
    }
    return evaluateDynamicPartialProperty(key, value, context, result);
}

/**
 * Resolves and merges one static object spread.
 *
 * @param spread Spread element.
 * @param context Shared evaluation inputs.
 * @param result Mutable partial result.
 * @returns Whether the spread is statically supported.
 */
function evaluatePartialSpread(
    spread: SpreadElementNode,
    context: PartialObjectContext,
    result: OxcPartialObjectResult,
): boolean {
    const object = resolveObjectExpression(spread.argument, context.bindings);
    if (!object) return false;
    try {
        Object.assign(
            result.staticProps,
            astObjectToSzObject(object, context.filename, context.bindings),
        );
        return true;
    } catch (error) {
        if (error instanceof OxcNotImplementedError) return false;
        throw error;
    }
}

/**
 * Attempts static evaluation of one property.
 *
 * @param key Static property key.
 * @param value Unwrapped property value.
 * @param context Shared evaluation inputs.
 * @param result Mutable partial result.
 * @returns Whether static evaluation succeeded.
 */
function tryEvaluateStaticPartialProperty(
    key: string,
    value: OxcNode,
    context: PartialObjectContext,
    result: OxcPartialObjectResult,
): boolean {
    try {
        result.staticProps[key] =
            value.type === 'ObjectExpression'
                ? astObjectToSzObject(
                      value as ObjectExpressionNode,
                      context.filename,
                      context.bindings,
                  )
                : astValueToSzValue(value, context.filename, context.bindings);
        return true;
    } catch (error) {
        if (error instanceof OxcNotImplementedError) return false;
        throw error;
    }
}

/**
 * Recursively evaluates a nested variant object.
 *
 * @param key Variant key.
 * @param value Variant object.
 * @param context Shared evaluation inputs.
 * @param result Mutable partial result.
 * @returns Whether the nested object is supported.
 */
function evaluateNestedPartialVariant(
    key: string,
    value: ObjectExpressionNode,
    context: PartialObjectContext,
    result: OxcPartialObjectResult,
): boolean {
    const variantChain = context.variantChain ? `${context.variantChain}-${key}` : key;
    const nested = evaluatePartialObject(
        value,
        context.filename,
        context.bindings,
        context.source,
        context.globalVarAliases,
        context.cssVariableMap,
        variantChain,
    );
    if (!nested) return false;
    if (Object.keys(nested.staticProps).length > 0) result.staticProps[key] = nested.staticProps;
    for (const [nestedKey, nestedInfo] of nested.dynamicProps) {
        result.dynamicProps.set(nestedKey, nestedInfo);
    }
    result.conditionalClasses.push(...nested.conditionalClasses);
    result.usesColorVar ||= nested.usesColorVar;
    result.usesSpacingVar ||= nested.usesSpacingVar;
    result.usesUnitVar ||= nested.usesUnitVar;
    return true;
}

/**
 * Compiles a finite conditional property into two static class branches.
 *
 * @param key Static property key.
 * @param conditional Conditional value.
 * @param context Shared evaluation inputs.
 * @param result Mutable partial result.
 * @returns Whether both branches are static literals.
 */
function evaluatePartialConditional(
    key: string,
    conditional: ConditionalExpressionNode,
    context: PartialObjectContext,
    result: OxcPartialObjectResult,
): boolean {
    const consequent = extractStaticLiteralValue(conditional.consequent);
    const alternate = extractStaticLiteralValue(conditional.alternate);
    if (consequent === null || alternate === null) return false;
    const consequentClasses = compileAliasedPartialClass(key, consequent, context);
    const alternateClasses = compileAliasedPartialClass(key, alternate, context);
    result.conditionalClasses.push({
        test: conditional.test,
        consequent: prefixVariantClasses(consequentClasses, context.variantChain),
        alternate: prefixVariantClasses(alternateClasses, context.variantChain),
    });
    return true;
}

/**
 * Compiles one aliased static property value.
 *
 * @param key Static property key.
 * @param value Static property value.
 * @param context Shared evaluation inputs.
 * @returns Compiled class string.
 */
function compileAliasedPartialClass(
    key: string,
    value: string | number | boolean,
    context: PartialObjectContext,
): string {
    const object = applyGlobalVarAliasesToSzObject(
        { [key]: value },
        context.globalVarAliases,
        context.cssVariableMap,
    );
    return compileSzObject(object).className;
}

/**
 * Records one runtime property and its required value helper.
 *
 * @param key Static property key.
 * @param value Runtime expression.
 * @param context Shared evaluation inputs.
 * @param result Mutable partial result.
 * @returns Whether the expression can be evaluated at runtime.
 */
function evaluateDynamicPartialProperty(
    key: string,
    value: OxcNode,
    context: PartialObjectContext,
    result: OxcPartialObjectResult,
): boolean {
    if (!isRuntimeExpression(value)) return false;
    const twPrefix = PROPERTY_MAP[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const category = getPropertyCategory(key);
    const uniqueKey = context.variantChain ? `${context.variantChain}-${key}` : key;
    markPartialRuntimeHelper(key, category, result);
    result.dynamicProps.set(uniqueKey, {
        expression: value,
        category,
        szKey: key,
        varName: getCSSVariableName(key, context.variantChain || undefined),
        twPrefix,
        variantChain: context.variantChain,
    });
    return true;
}

/**
 * Marks the runtime helper required by one property category.
 *
 * @param key Static property key.
 * @param category Property category.
 * @param result Mutable partial result.
 */
function markPartialRuntimeHelper(
    key: string,
    category: PropertyCategory,
    result: OxcPartialObjectResult,
): void {
    if (COLOR_PROPERTIES.has(key)) result.usesColorVar = true;
    else if (category === PropertyCategory.SPACING) result.usesSpacingVar = true;
    else if (category === PropertyCategory.ANGLE || category === PropertyCategory.DURATION) {
        result.usesUnitVar = true;
    }
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
            return `__szSpacingVar(${expressionSource}, ${JSON.stringify(info.szKey)})`;
        case PropertyCategory.COLOR:
            return `__szColorVar(${expressionSource})`;
        case PropertyCategory.ANGLE:
            return `__szUnitVar(${expressionSource}, "deg", ${JSON.stringify(info.szKey)})`;
        case PropertyCategory.DURATION:
            return `__szUnitVar(${expressionSource}, "ms", ${JSON.stringify(info.szKey)})`;
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
            // The helper's output depends on the key (screen -> 100vw vs 100vh),
            // so identical expressions on different keys must not share a var.
            return `spacing:${info.szKey}:${expressionSource}`;
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
    const state: ParenthesisScanState = { depth: 0, quote: null, escaped: false };
    for (let index = 0; index < expressionSource.length; index++) {
        if (!scanParenthesisCharacter(expressionSource[index], index, expressionSource, state)) {
            return false;
        }
    }
    return state.depth === 0;
}

/** Mutable state for redundant-parenthesis validation. */
interface ParenthesisScanState {
    depth: number;
    quote: string | null;
    escaped: boolean;
}

/**
 * Consume one character while checking whether the outer pair spans the input.
 * @param char - Current source character.
 * @param index - Current source offset.
 * @param source - Full expression source.
 * @param state - Mutable scanner state.
 * @returns Whether the outer pair can still span the full input.
 */
function scanParenthesisCharacter(
    char: string,
    index: number,
    source: string,
    state: ParenthesisScanState,
): boolean {
    if (state.quote) {
        if (state.escaped) state.escaped = false;
        else if (char === '\\') state.escaped = true;
        else if (char === state.quote) state.quote = null;
        return true;
    }
    if (char === '"' || char === "'" || char === '`') {
        state.quote = char;
        return true;
    }
    if (char === '(') state.depth++;
    if (char === ')') state.depth--;
    return state.depth >= 0 && (state.depth !== 0 || index === source.length - 1);
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
 * @param branchPick When set, a conditional value resolves to this branch.
 * @returns Plain JS value usable by `transform()`.
 */
function astValueToSzValue(
    node: OxcNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    branchPick?: 'consequent' | 'alternate',
): SzValue {
    // TypeScript wrappers (`satisfies` / `as` / `!` / parens) are type-level
    // only — look straight through them so e.g. a variant table written as
    // `{ … } satisfies Record<Token, object>` still converts.
    node = unwrapExpression(node);
    // When resolving a single branch of a hoisted nested conditional, substitute
    // the conditional value with its chosen branch and convert that statically.
    if (branchPick && node.type === 'ConditionalExpression') {
        return astValueToSzValue(
            (node as ConditionalExpressionNode)[branchPick],
            filename,
            bindings,
            branchPick,
        );
    }
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
        return astObjectToSzObject(node as ObjectExpressionNode, filename, bindings, branchPick);
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
 * Collect const-declared identifier initializers of ANY expression shape,
 * unwrapped of TS-only wrappers. The szv catalog's lenient leaf resolution
 * needs scalar initializers (`const GUTTER = 0`) that the object-only binding
 * map cannot hold. Const-only, so a reassigned `let` is never followed.
 *
 * @param root Program root.
 * @returns Identifier name to unwrapped initializer node.
 */
function collectConstInitializers(root: OxcNode): Map<string, OxcNode> {
    const inits = new Map<string, OxcNode>();
    walk(root, node => {
        if (node.type !== 'VariableDeclaration') {
            return;
        }
        const decl = node as unknown as { kind?: string; declarations?: OxcNode[] };
        if (decl.kind !== 'const' || !decl.declarations) {
            return;
        }
        for (const declaratorNode of decl.declarations) {
            const declarator = declaratorNode as unknown as {
                id?: OxcNode;
                init?: OxcNode | null;
            };
            if (!declarator.id || declarator.id.type !== 'Identifier' || !declarator.init) {
                continue;
            }
            inits.set(
                String((declarator.id as IdentifierNode).name),
                unwrapExpression(declarator.init),
            );
        }
    });
    return inits;
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
