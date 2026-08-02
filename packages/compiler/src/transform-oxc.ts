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
import {
    describeSzFallback,
    formatSzFallbackDiagnostic,
    SZ_FALLBACK_UNKNOWN_CALLEE,
    type SzFallbackKind,
    type SzFallbackSite,
    szsUnsupportedDiagnostic,
} from './sz-fallback-matrix.js';
import { SZR_IMPORT_REWRITE_TARGETS, szrRewriteProofHolds } from './szr-import-rewrite.js';
import {
    coerceParitySafeSelectionValue,
    computeStaticSzvPick,
    emitUnprovenSzrFallbacks,
    qualifyStaticSzvConfig,
    recordCrossModuleSzvFactoryImports,
    recordIdentifierCallByName,
    recordSzvTypeQueryByName,
    type StaticSzvSelection,
    SZV_RESERVED_FACTORY_NAMES,
    type SzrArgumentAnalysisOf,
    type SzvPrecompiledTable,
    type SzvPrecompileState,
    serializeSzvTable,
    singleDimensionPickAllowed,
    szvFactoryAccountingHolds,
    szvTableIdentifier,
} from './szv-precompile.js';
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
     * User-facing description of the unimplemented construct, without the
     * internal slice label. Fallback warnings must print THIS, not `message` —
     * the slice codes are planning shorthand and leaked verbatim into build
     * logs ("D2.5+ not implemented yet", field-reported as baffling).
     */
    readonly detail: string;

    /**
     * @param slice The Phase D slice expected to implement this path.
     * @param detail What the caller asked for that is not yet wired.
     */
    constructor(slice: string, detail: string) {
        super(`transformOxc: ${slice} not implemented yet — ${detail}`);
        this.name = 'OxcNotImplementedError';
        this.detail = detail;
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
            usesSzvPick: false,
            usesSzvPick1: false,
            szPartArgsProvable: true,
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
    oxcSzPartArgsProvable = true;
    const szrRewrite: OxcSzrRewriteState = {
        pendingFallbacks: [],
        sourceSpan: null,
        sourceValue: '',
        statementSpan: null,
        otherSpecifierSpans: [],
        szrCalls: [],
    };
    const crossModuleStatics = options?.crossModuleStatics;
    const szvPrecompile: OxcSzvPrecompileState = {
        // Every transformed file would otherwise pay the identifier-call map
        // for nothing; without an szv call — or a cross-module entry that can
        // introduce an imported factory — there is nothing to precompile.
        enabled:
            source.includes('szv(') ||
            (crossModuleStatics !== undefined && Object.keys(crossModuleStatics).length > 0),
        crossModuleStatics,
        typeQueryCounts: new Map(),
        candidates: new Map(),
        identifierCalls: new Map(),
        replacedCalls: new Set(),
        szrArgumentAnalyses: new Map(),
        // Only the szv/szr proofs read these, so a file with neither pays
        // nothing for mapping every comment in it.
        commentSpans:
            source.includes('szv(') || source.includes('szr')
                ? (
                      (parsed as unknown as { comments?: Array<{ start: number; end: number }> })
                          .comments ?? []
                  ).map(comment => ({ start: comment.start, end: comment.end }))
                : [],
        usedPick: false,
        usedPick1: false,
    };
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
        if (node.type === 'ImportDeclaration') {
            recordSzrImportCandidateOxc(node, szrRewrite);
            recordCrossModuleSzvFactoriesOxc(node, szvPrecompile);
            return;
        }
        if (node.type === 'VariableDeclaration') {
            recordSzvFactoryCandidatesOxc(node, szvPrecompile);
        }
        if (node.type === 'TSTypeQuery') {
            recordSzvTypeQueryOxc(node, szvPrecompile);
        }
        if (node.type === 'CallExpression') {
            recordIdentifierCallOxc(node as CallExpressionNode, szrRewrite, szvPrecompile);
            collectDynamicCallClasses(
                node as CallExpressionNode,
                effectiveFilename,
                objectBindings,
                classes,
                szrRewrite,
            );
            collectSzvCallClasses(
                node as CallExpressionNode,
                constObjectBindings,
                constInitializers,
                classes,
                source,
                diagnostics,
            );
            return;
        }
        if (node.type !== 'JSXOpeningElement') {
            return;
        }
        const openingNode = node as unknown as JsxOpeningElementNode;
        const openingAttributes = collectOxcOpeningAttributes(openingNode.attributes ?? []);
        const szAttrs = openingAttributes.sz;
        const szsAttrs = openingAttributes.szs;
        const classNameAttr = openingAttributes.className;
        const styleAttr = openingAttributes.style;
        const lastAttr = openingAttributes.last;
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

        transformed =
            transformOxcRecoveryAttribute({
                attribute: openingAttributes.recovery,
                alreadyTagged: openingAttributes.alreadyTagged,
                lastAttribute: lastAttr,
                openingNode,
                filename: effectiveFilename,
                source,
                edits,
                diagnostics,
                recoveryTokens,
            }) || transformed;
        collectOxcRawClassName(classNameAttr, rawClassNames);

        transformed =
            transformOxcSzsAttributes({
                attributes: szsAttrs,
                openingNode,
                // Raw on purpose: the szs diagnostics apply the same '<anonymous>'
                // default the Babel lane uses; effectiveFilename's 'file.tsx' is a
                // PARSER default and must not leak into shared wording.
                filename,
                rootDir: options?.rootDir,
                bindings: objectBindings,
                source,
                edits,
                diagnostics,
                pendingClasses: szsPendingClasses,
                globalVarAliases,
                cssVariableMap,
            }) || transformed;
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
            const attributeResult = transformOxcSzAttribute({
                szAttr,
                szAttrs,
                classNameAttr,
                styleAttr,
                lastAttr,
                openingAttributes,
                openingNameEnd: openingNode.name.end,
                elementId,
                hoistedStyleProps,
                filename: effectiveFilename,
                source,
                options,
                bindings: objectBindings,
                conditionalBindings,
                componentHoists,
                reservedCSSVariableNames,
                globalVarAliases,
                cssVariableMap,
                classes,
                szDerived,
                diagnostics,
                edits,
            });
            if (attributeResult.kind === 'continue') continue;
            if (attributeResult.kind === 'fallback') {
                runtimeFallbackExpr = attributeResult.expression;
                runtimeFallbackAttr = szAttr;
                break;
            }
            appliedHoistedStyleProps ||= attributeResult.appliedHoistedStyleProps;
            usesRuntime ||= attributeResult.usesRuntime;
            usesMerge ||= attributeResult.usesMerge;
            usesSzcn ||= attributeResult.usesSzcn;
            usesSzPart ||= attributeResult.usesSzPart;
            usesColorVar ||= attributeResult.usesColorVar;
            usesSpacingVar ||= attributeResult.usesSpacingVar;
            usesUnitVar ||= attributeResult.usesUnitVar;
            transformed = true;
            return;
        }
        // Done lowering this element's sz attributes — drop the location so an
        // unrelated later transform (or the runtime path) doesn't inherit it.
        setSzWarnLocation(undefined);

        if (
            transformOxcRuntimeFallback({
                expression: runtimeFallbackExpr,
                attribute: runtimeFallbackAttr,
                attributes: szAttrs,
                classNameAttribute: classNameAttr,
                filename: effectiveFilename,
                bindings: objectBindings,
                source,
                edits,
                classes,
                diagnostics,
            })
        ) {
            usesRuntime = true;
            // With an existing className the fallback emits _szMerge(existing, _sz(...)).
            usesMerge ||= classNameAttr !== null;
            transformed = true;
            return;
        }
        applyHoistedStyleProps();

        const mergeResult = mergeOxcStaticElementClasses(
            szAttrs,
            classNameAttr,
            szDerived,
            source,
            edits,
        );
        usesRuntime ||= mergeResult.usesRuntime;
        usesMerge ||= mergeResult.usesMerge;
        transformed = true;
    });

    // szs classes join AFTER every sz-derived class so the discovery order
    // (which fixes production mangle IDs) matches the other engines.
    for (const c of szsPendingClasses) {
        classes.add(c);
    }

    if (applySzvPrecompileOxc(szvPrecompile, szrRewrite, source, edits)) {
        transformed = true;
    }
    emitPendingSzrFallbacksOxc(szrRewrite, szvPrecompile, source, diagnostics);
    if (applySzrImportRewriteOxc(szrRewrite, szvPrecompile, source, edits)) {
        transformed = true;
    }

    return {
        code: transformed ? edits.toString() : source,
        transformed,
        usesSzvPick: szvPrecompile.usedPick,
        usesSzvPick1: szvPrecompile.usedPick1,
        szPartArgsProvable: oxcSzPartArgsProvable,
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

/** Inputs shared while classifying one JSX sz attribute. */
interface OxcSzAttributeContext {
    szAttr: JsxAttributeNode;
    szAttrs: JsxAttributeNode[];
    classNameAttr: JsxAttributeNode | null;
    styleAttr: JsxAttributeNode | null;
    lastAttr: JsxAttributeNode | null;
    openingAttributes: OxcOpeningAttributes;
    openingNameEnd: number;
    elementId: string;
    hoistedStyleProps: string[];
    filename: string;
    source: string;
    options: TransformSourceCodeOptions | undefined;
    bindings: ReadonlyMap<string, ObjectExpressionNode>;
    conditionalBindings: ReadonlyMap<string, ConditionalExpressionNode>;
    componentHoists: OxcComponentHoistAnalysis | null;
    reservedCSSVariableNames: ReadonlySet<string> | undefined;
    globalVarAliases: ReadonlyMap<string, string>;
    cssVariableMap: Map<string, CssVariableMangleValue>;
    classes: Set<string>;
    szDerived: string[];
    diagnostics: string[];
    edits: MagicString;
}

/** Control result for one sz attribute. */
type OxcSzAttributeResult =
    | { kind: 'continue' }
    | { kind: 'fallback'; expression: OxcNode }
    | ({ kind: 'complete' } & OxcSzUsageFlags);

/**
 * Per-call provability accumulator for emitted `_szPart` arguments.
 *
 * Module state on the `szWarnLocation` precedent: the emission site sits
 * several layers below the entry, and a reset at each `transformOxc` call
 * keeps it sound in the single-threaded transform.
 */
let oxcSzPartArgsProvable = true;

/** Runtime/helper flags emitted by one completed sz rewrite. */
interface OxcSzUsageFlags {
    appliedHoistedStyleProps: boolean;
    usesRuntime: boolean;
    usesMerge: boolean;
    usesSzcn: boolean;
    usesSzPart: boolean;
    usesColorVar: boolean;
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
}

/**
 * Classify and rewrite one sz attribute without nesting inside the JSX visitor.
 *
 * @param context Attribute, element, and transform state.
 * @returns Loop control plus helper usage for a completed rewrite.
 */
function transformOxcSzAttribute(context: OxcSzAttributeContext): OxcSzAttributeResult {
    setOxcSzWarningLocation(context);
    const value = context.szAttr.value;
    if (!value) {
        throw new OxcNotImplementedError(
            'D3',
            `sz attribute without value at ${context.filename}:${context.szAttr.start}`,
        );
    }
    const stringValue = stringLiteralValue(value);
    if (stringValue !== null) {
        collectOxcClassTokens(stringValue, context.classes, context.szDerived);
        return { kind: 'continue' };
    }
    if (value.type !== 'JSXExpressionContainer') {
        throw new OxcNotImplementedError(
            'D3',
            `unsupported sz attribute value ${value.type} at ${context.filename}:${context.szAttr.start}`,
        );
    }
    const expression = (value as unknown as { expression: OxcNode }).expression;
    return transformOxcSzExpression(expression, context);
}

/**
 * Attach source location to dev warnings for one sz attribute.
 *
 * @param context Attribute source and transform options.
 */
function setOxcSzWarningLocation(context: OxcSzAttributeContext): void {
    const { line } = offsetToLineColumn(context.source, context.szAttr.start);
    setSzWarnLocation(formatSzWarnLocation(context.filename, line, context.options?.rootDir));
}

/**
 * Lower a JSX expression-container value into one attribute control result.
 *
 * @param expression Expression stored in the sz JSX container.
 * @param context Attribute and element transform state.
 * @returns Loop control plus helper usage for a completed rewrite.
 */
function transformOxcSzExpression(
    expression: OxcNode,
    context: OxcSzAttributeContext,
): OxcSzAttributeResult {
    const identifierResult = transformOxcIdentifierExpression(expression, context);
    if (identifierResult) return identifierResult;

    const conditional = resolveOxcStaticConditional(expression, context.conditionalBindings);
    if (conditional) {
        const result = transformOxcStaticConditional({
            conditional,
            filename: context.filename,
            bindings: context.bindings,
            source: context.source,
            classes: context.classes,
            globalVarAliases: context.globalVarAliases,
            cssVariableMap: context.cssVariableMap,
            classNameAttr: context.classNameAttr,
            szAttributeCount: context.szAttrs.length,
            szAttr: context.szAttr,
            edits: context.edits,
        });
        if (result === 'fallback') return { kind: 'fallback', expression };
        if (result === 'complete') return completeOxcSzUsage();
        if (result === 'complete-merge') {
            // Babel reports both flags for a className merge, so the injected
            // helper imports stay byte-identical across the two lanes.
            return completeOxcSzUsage({ usesMerge: true, usesRuntime: true });
        }
    }
    if (expression.type === 'ArrayExpression') {
        return transformOxcSzArrayResult(expression as ArrayExpressionNode, context);
    }
    if (expression.type !== 'ObjectExpression') return { kind: 'fallback', expression };
    return transformOxcObjectExpression(expression as ObjectExpressionNode, context);
}

/**
 * Resolve a static identifier immediately; conditional identifiers continue.
 *
 * @param expression Candidate identifier expression.
 * @param context Attribute state containing static object bindings.
 * @returns Attribute control when the identifier is statically bound, otherwise null.
 */
function transformOxcIdentifierExpression(
    expression: OxcNode,
    context: OxcSzAttributeContext,
): OxcSzAttributeResult | null {
    if (expression.type !== 'Identifier') return null;
    const bound = context.bindings.get(String((expression as IdentifierNode).name));
    if (!bound) return null;
    const result = compileSzObject(
        applyGlobalVarAliasesToSzObject(
            astObjectToSzObject(bound, context.filename, context.bindings),
            context.globalVarAliases,
            context.cssVariableMap,
        ),
    );
    collectOxcClassTokens(result.className, context.classes, context.szDerived);
    return { kind: 'continue' };
}

/**
 * Resolve direct and identifier-backed finite conditionals.
 *
 * @param expression Candidate conditional or identifier expression.
 * @param bindings Finite conditionals collected from local bindings.
 * @returns The resolved conditional when statically known.
 */
function resolveOxcStaticConditional(
    expression: OxcNode,
    bindings: ReadonlyMap<string, ConditionalExpressionNode>,
): ConditionalExpressionNode | undefined {
    if (expression.type === 'ConditionalExpression') {
        return expression as ConditionalExpressionNode;
    }
    if (expression.type !== 'Identifier') return undefined;
    return bindings.get(String((expression as IdentifierNode).name));
}

/**
 * Adapt the array-lane control result to the shared attribute result.
 *
 * @param expression Array expression from the sz attribute.
 * @param context Attribute and element transform state.
 * @returns Shared attribute control and helper-usage flags.
 */
function transformOxcSzArrayResult(
    expression: ArrayExpressionNode,
    context: OxcSzAttributeContext,
): OxcSzAttributeResult {
    const result = transformOxcArrayExpression({
        expression,
        filename: context.filename,
        bindings: context.bindings,
        globalVarAliases: context.globalVarAliases,
        cssVariableMap: context.cssVariableMap,
        source: context.source,
        classes: context.classes,
        diagnostics: context.diagnostics,
        szDerived: context.szDerived,
        classNameAttr: context.classNameAttr,
        szAttrs: context.szAttrs,
        szAttr: context.szAttr,
        edits: context.edits,
    });
    if (result.kind === 'fallback') return { kind: 'fallback', expression };
    if (result.kind === 'continue') return { kind: 'continue' };
    return completeOxcSzUsage({ usesSzcn: true, usesSzPart: result.usesSzPart });
}

/**
 * Lower a static or partially-static object expression.
 *
 * @param expression Object expression from the sz attribute.
 * @param context Attribute and element transform state.
 * @returns Shared attribute control and helper-usage flags.
 */
function transformOxcObjectExpression(
    expression: ObjectExpressionNode,
    context: OxcSzAttributeContext,
): OxcSzAttributeResult {
    try {
        const object = astObjectToSzObject(expression, context.filename, context.bindings);
        const result = compileSzObject(
            applyGlobalVarAliasesToSzObject(
                object,
                context.globalVarAliases,
                context.cssVariableMap,
            ),
        );
        collectOxcClassTokens(result.className, context.classes, context.szDerived);
        return { kind: 'continue' };
    } catch (error) {
        if (!(error instanceof OxcNotImplementedError)) throw error;
        const result = transformOxcUnsupportedObject({
            expression,
            filename: context.filename,
            bindings: context.bindings,
            source: context.source,
            classes: context.classes,
            globalVarAliases: context.globalVarAliases,
            cssVariableMap: context.cssVariableMap,
            options: context.options,
            plannedUsageNames: context.componentHoists?.usageNamesByElement.get(context.elementId),
            reservedCSSVariableNames: context.reservedCSSVariableNames,
            hoistedStyleProps: context.hoistedStyleProps,
            openingAttributes: context.openingAttributes,
            styleAttr: context.styleAttr,
            lastAttr: context.lastAttr,
            classNameAttr: context.classNameAttr,
            szAttrs: context.szAttrs,
            szAttr: context.szAttr,
            openingNameEnd: context.openingNameEnd,
            edits: context.edits,
            diagnostics: context.diagnostics,
        });
        if (!result) return { kind: 'fallback', expression };
        return completeOxcSzUsage(result);
    }
}

/**
 * Normalize sparse helper flags into one complete attribute result.
 *
 * @param overrides Helper flags emitted by the selected lowering lane.
 * @returns A completed attribute result with every usage flag populated.
 */
function completeOxcSzUsage(overrides: Partial<OxcSzUsageFlags> = {}): OxcSzAttributeResult {
    return {
        kind: 'complete',
        appliedHoistedStyleProps: false,
        usesRuntime: false,
        usesMerge: false,
        usesSzcn: false,
        usesSzPart: false,
        usesColorVar: false,
        usesSpacingVar: false,
        usesUnitVar: false,
        ...overrides,
    };
}

/**
 * Record non-empty class tokens in discovery order and optional element output.
 *
 * @param className Whitespace-delimited class string.
 * @param classes Transform-wide discovery set.
 * @param derived Optional element-local ordered class list.
 */
function collectOxcClassTokens(className: string, classes: Set<string>, derived?: string[]): void {
    for (const token of className.split(/\s+/)) {
        if (!token) continue;
        derived?.push(token);
        classes.add(token);
    }
}

/** State needed to recover an object that the fully-static converter rejected. */
interface OxcUnsupportedObjectContext {
    expression: ObjectExpressionNode;
    filename: string;
    bindings: ReadonlyMap<string, ObjectExpressionNode>;
    source: string;
    classes: Set<string>;
    globalVarAliases: ReadonlyMap<string, string>;
    cssVariableMap: Map<string, CssVariableMangleValue>;
    options: TransformSourceCodeOptions | undefined;
    plannedUsageNames: ReadonlyMap<string, string> | undefined;
    reservedCSSVariableNames: ReadonlySet<string> | undefined;
    hoistedStyleProps: string[];
    openingAttributes: OxcOpeningAttributes;
    styleAttr: JsxAttributeNode | null;
    lastAttr: JsxAttributeNode | null;
    classNameAttr: JsxAttributeNode | null;
    szAttrs: JsxAttributeNode[];
    szAttr: JsxAttributeNode;
    openingNameEnd: number;
    edits: MagicString;
    diagnostics: string[];
}

/** Flags accumulated by a completed partial-object rewrite. */
interface OxcUnsupportedObjectComplete {
    kind: 'complete';
    appliedHoistedStyleProps: boolean;
    usesRuntime: boolean;
    usesMerge: boolean;
    usesColorVar: boolean;
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
}

/**
 * Recover conditional and dynamic-value object forms outside static lowering.
 *
 * @param context Object expression and element rewrite state.
 * @returns Completion flags, or null when runtime fallback is required.
 */
function transformOxcUnsupportedObject(
    context: OxcUnsupportedObjectContext,
): OxcUnsupportedObjectComplete | null {
    const classExpression =
        buildConditionalSpreadClassExpression(
            context.expression,
            context.filename,
            context.bindings,
            context.source,
            context.classes,
            context.globalVarAliases,
            context.cssVariableMap,
        ) ??
        buildNestedConditionalClassExpression(
            context.expression,
            context.filename,
            context.bindings,
            context.source,
            context.classes,
            context.globalVarAliases,
            context.cssVariableMap,
        );
    if (classExpression) {
        if (context.szAttrs.length > 1) return null;
        if (context.classNameAttr) {
            // Merge the hoisted-conditional class expression with the existing
            // className, matching the Babel emit — this used to bail the whole
            // file to the Babel fallback (D2.5+).
            const existing = classNameMergeArgument(context.classNameAttr, context.source);
            context.edits.overwrite(
                context.classNameAttr.start,
                context.classNameAttr.end,
                `className={_szMerge(${existing}, ${classExpression})}`,
            );
            context.edits.remove(
                whitespaceStart(context.source, context.szAttr.start),
                context.szAttr.end,
            );
            return completedUnsupportedObject(true, true);
        }
        context.edits.overwrite(
            context.szAttr.start,
            context.szAttr.end,
            `className={${classExpression}}`,
        );
        return completedUnsupportedObject(false, false);
    }

    const partial = buildPartialObjectTransform({
        node: context.expression,
        filename: context.filename,
        bindings: context.bindings,
        source: context.source,
        options: context.options,
        hoistedNames: context.plannedUsageNames,
        cssVariableMap: context.cssVariableMap,
        reservedNames: context.reservedCSSVariableNames,
        globalVarAliases: context.globalVarAliases,
    });
    if (!partial || context.szAttrs.length !== 1) {
        return null;
    }
    const mergedStyleProps =
        context.hoistedStyleProps.length > 0
            ? [...context.hoistedStyleProps, ...partial.styleProps]
            : partial.styleProps;
    const spreadStyleRewrite = buildOxcSafeStyleSpreadRewrite(
        context.openingAttributes.spreads,
        context.styleAttr,
        mergedStyleProps,
        context.source,
    );
    warnOxcStyleSpreadCollision(
        mergedStyleProps,
        hasUnresolvedStyleSpread(context.openingAttributes.hasSpread, spreadStyleRewrite),
        context.filename,
        context.diagnostics,
    );
    const expressionClassName = context.classNameAttr?.value?.type === 'JSXExpressionContainer';
    rewriteOxcPartialClassName(context, partial, expressionClassName);
    applyOxcGeneratedStyle(
        context.edits,
        context.source,
        context.styleAttr,
        context.lastAttr,
        mergedStyleProps,
        context.openingNameEnd,
        spreadStyleRewrite,
    );
    collectOxcClassTokens(partial.className, context.classes);
    // A literal className beside a conditional also merges through _szMerge
    // (see rewriteOxcPartialClassName), so it needs the runtime helpers too.
    const mergesClassName =
        expressionClassName || (partial.hasConditional && context.classNameAttr !== null);
    return {
        ...completedUnsupportedObject(mergesClassName, mergesClassName),
        usesColorVar: partial.usesColorVar,
        usesSpacingVar: partial.usesSpacingVar,
        usesUnitVar: partial.usesUnitVar,
    };
}

/**
 * Rewrite className for one accepted partial-object transform.
 *
 * @param context Element rewrite state.
 * @param partial Prepared partial-object output.
 * @param expressionClassName Whether authored className requires `_szMerge`.
 */
function rewriteOxcPartialClassName(
    context: OxcUnsupportedObjectContext,
    partial: OxcPartialTransform,
    expressionClassName: boolean,
): void {
    if (expressionClassName && context.classNameAttr?.value) {
        const classExpression = (context.classNameAttr.value as unknown as { expression: OxcNode })
            .expression;
        const classSource = context.source.slice(classExpression.start, classExpression.end);
        context.edits.overwrite(
            context.classNameAttr.start,
            context.classNameAttr.end,
            `className={_szMerge(${classSource}, ${partial.classExpression})}`,
        );
        context.edits.remove(
            whitespaceStart(context.source, context.szAttr.start),
            context.szAttr.end,
        );
        return;
    }
    if (context.classNameAttr && stringLiteralValue(context.classNameAttr.value) !== null) {
        const existing = stringLiteralValue(context.classNameAttr.value);
        if (partial.hasConditional) {
            // A literal className cannot absorb a conditional statically — merge
            // it with the conditional expression, matching the Babel emit.
            context.edits.overwrite(
                context.classNameAttr.start,
                context.classNameAttr.end,
                `className={_szMerge(${JSON.stringify(existing)}, ${partial.classExpression})}`,
            );
        } else {
            const merged = [existing, partial.className].filter(Boolean).join(' ');
            context.edits.overwrite(
                context.classNameAttr.start,
                context.classNameAttr.end,
                `className="${merged}"`,
            );
        }
        context.edits.remove(
            whitespaceStart(context.source, context.szAttr.start),
            context.szAttr.end,
        );
        return;
    }
    context.edits.overwrite(context.szAttr.start, context.szAttr.end, partial.classNameAttr);
}

/**
 * Build common completion flags for a recovered object rewrite.
 *
 * @param usesRuntime Whether the rewrite requires runtime helpers.
 * @param usesMerge Whether the rewrite emits `_szMerge`.
 * @returns Normalized completion flags.
 */
function completedUnsupportedObject(
    usesRuntime: boolean,
    usesMerge: boolean,
): OxcUnsupportedObjectComplete {
    return {
        kind: 'complete',
        appliedHoistedStyleProps: true,
        usesRuntime,
        usesMerge,
        usesColorVar: false,
        usesSpacingVar: false,
        usesUnitVar: false,
    };
}

/** Inputs for lowering a statically resolvable conditional sz expression. */
interface OxcStaticConditionalContext {
    conditional: ConditionalExpressionNode;
    filename: string;
    bindings: ReadonlyMap<string, ObjectExpressionNode>;
    source: string;
    classes: Set<string>;
    globalVarAliases: ReadonlyMap<string, string>;
    cssVariableMap: Map<string, CssVariableMangleValue>;
    classNameAttr: JsxAttributeNode | null;
    szAttributeCount: number;
    szAttr: JsxAttributeNode;
    edits: MagicString;
}

/**
 * Rewrite a finite conditional directly, or select the merge fallback lane.
 *
 * @param context Conditional expression and element rewrite state.
 * @returns Whether the caller should continue, fall back, or finish the element.
 */
function transformOxcStaticConditional(
    context: OxcStaticConditionalContext,
): 'continue' | 'fallback' | 'complete' | 'complete-merge' {
    const classExpression = buildStaticConditionalClassExpression(
        context.conditional,
        context.filename,
        context.bindings,
        context.source,
        context.classes,
        context.globalVarAliases,
        context.cssVariableMap,
    );
    if (!classExpression) return 'continue';
    if (context.szAttributeCount > 1) return 'fallback';
    if (context.classNameAttr) {
        // Same emit as the Babel engine: the compiled ternary merges with the
        // existing className. This used to route to the runtime fallback,
        // whose className branch then bailed the whole file to Babel (D2.5+).
        const existing = classNameMergeArgument(context.classNameAttr, context.source);
        context.edits.overwrite(
            context.classNameAttr.start,
            context.classNameAttr.end,
            `className={_szMerge(${existing}, ${classExpression})}`,
        );
        context.edits.remove(
            whitespaceStart(context.source, context.szAttr.start),
            context.szAttr.end,
        );
        return 'complete-merge';
    }
    context.edits.overwrite(
        context.szAttr.start,
        context.szAttr.end,
        `className={${classExpression}}`,
    );
    return 'complete';
}

/** Inputs required to lower one sz array without coupling to the JSX visitor. */
interface OxcArrayTransformContext {
    expression: ArrayExpressionNode;
    filename: string;
    bindings: ReadonlyMap<string, ObjectExpressionNode>;
    globalVarAliases: ReadonlyMap<string, string>;
    cssVariableMap: Map<string, CssVariableMangleValue>;
    source: string;
    classes: Set<string>;
    diagnostics: string[];
    szDerived: string[];
    classNameAttr: JsxAttributeNode | null;
    szAttrs: JsxAttributeNode[];
    szAttr: JsxAttributeNode;
    edits: MagicString;
}

/** Control result returned to the element-level sz attribute loop. */
type OxcArrayTransformResult =
    | { kind: 'continue'; usesSzPart: false }
    | { kind: 'fallback'; usesSzPart: false }
    | { kind: 'complete'; usesSzPart: boolean };

/**
 * Lower one sz array into either static classes, a runtime fallback, or `_szcn`.
 *
 * @param context Array expression and element rewrite state.
 * @returns Control action for the surrounding sz attribute loop.
 */
function transformOxcArrayExpression(context: OxcArrayTransformContext): OxcArrayTransformResult {
    const composition = buildArrayComposition(context.expression, {
        filename: context.filename,
        bindings: context.bindings,
        globalVarAliases: context.globalVarAliases,
        cssVariableMap: context.cssVariableMap,
        source: context.source,
        classes: context.classes,
        diagnostics: context.diagnostics,
    });
    if (composition === null) {
        collectArrayCandidateClasses(
            context.expression,
            context.filename,
            context.bindings,
            context.classes,
            '',
        );
        return { kind: 'fallback', usesSzPart: false };
    }
    if (composition.kind === 'static') {
        for (const className of composition.classes) {
            context.szDerived.push(className);
            context.classes.add(className);
        }
        return { kind: 'continue', usesSzPart: false };
    }

    // Authored className is the first argument so later sz array entries retain
    // the same override order as szcn. Compiled runtime parts use the unmemoized
    // helper because their per-render values should not evict authored szcn keys.
    const existingExpression = context.classNameAttr
        ? classNameMergeArgument(context.classNameAttr, context.source)
        : null;
    const call = existingExpression
        ? `_szcn(${existingExpression}, ${composition.args})`
        : `_szcn(${composition.args})`;
    if (context.classNameAttr) {
        context.edits.overwrite(
            context.classNameAttr.start,
            context.classNameAttr.end,
            `className={${call}}`,
        );
        context.edits.remove(
            whitespaceStart(context.source, context.szAttr.start),
            context.szAttr.end,
        );
    } else {
        context.edits.overwrite(context.szAttr.start, context.szAttr.end, `className={${call}}`);
    }
    return { kind: 'complete', usesSzPart: composition.usesSzPart };
}

/** Result flags produced while merging one element's static class output. */
interface OxcStaticClassMergeResult {
    usesRuntime: boolean;
    usesMerge: boolean;
}

/**
 * Merge static sz classes after any authored className, preserving expressions.
 *
 * @param szAttrs Compiled sz attributes to remove or replace.
 * @param classNameAttr Existing className attribute, when present.
 * @param szDerived Ordered classes compiled from sz.
 * @param source Original source used to retain expression text.
 * @param edits Magic-string rewrite buffer.
 * @returns Runtime-helper flags required by the rewritten element.
 */
function mergeOxcStaticElementClasses(
    szAttrs: JsxAttributeNode[],
    classNameAttr: JsxAttributeNode | null,
    szDerived: string[],
    source: string,
    edits: MagicString,
): OxcStaticClassMergeResult {
    const existingRaw = classNameAttr ? stringLiteralValue(classNameAttr.value) : null;
    const mergedClasses = [
        ...(existingRaw ? existingRaw.split(/\s+/).filter(Boolean) : []),
        ...szDerived,
    ];
    const mergedAttr =
        mergedClasses.length === 0
            ? 'className={undefined}'
            : staticOxcClassNameAttribute(mergedClasses.join(' '));

    if (!classNameAttr) {
        const [firstSz, ...rest] = szAttrs;
        if (firstSz) {
            edits.overwrite(firstSz.start, firstSz.end, mergedAttr);
            removeOxcAttributes(rest, source, edits);
        }
        return { usesRuntime: false, usesMerge: false };
    }

    const classNameValue = classNameAttr.value;
    if (existingRaw === null && classNameValue?.type === 'JSXExpressionContainer') {
        const exprNode = (classNameValue as unknown as { expression: OxcNode }).expression;
        const exprSource = source.slice(exprNode.start, exprNode.end);
        edits.overwrite(
            classNameAttr.start,
            classNameAttr.end,
            `className={_szMerge(${exprSource}, ${JSON.stringify(szDerived.join(' '))})}`,
        );
        removeOxcAttributes(szAttrs, source, edits);
        return { usesRuntime: true, usesMerge: true };
    }

    edits.overwrite(classNameAttr.start, classNameAttr.end, mergedAttr);
    removeOxcAttributes(szAttrs, source, edits);
    return { usesRuntime: false, usesMerge: false };
}

/**
 * Remove JSX attributes together with their preceding whitespace.
 *
 * @param attributes Attributes selected for removal.
 * @param source Original source used to locate leading whitespace.
 * @param edits Magic-string rewrite buffer.
 */
function removeOxcAttributes(
    attributes: JsxAttributeNode[],
    source: string,
    edits: MagicString,
): void {
    for (const attribute of attributes) {
        edits.remove(whitespaceStart(source, attribute.start), attribute.end);
    }
}

/**
 * Serialize a static className without letting selector quotes break JSX syntax.
 *
 * @param className Compiled class string.
 * @returns JSX className attribute source.
 */
function staticOxcClassNameAttribute(className: string): string {
    return className.includes('"')
        ? `className={${JSON.stringify(className)}}`
        : `className="${className}"`;
}

/**
 * Whether an oxc object expression contains a top-level spread.
 *
 * @param expression Object expression to inspect.
 * @returns Whether a top-level spread is present.
 */
function hasOxcTopLevelSpread(expression: ObjectExpressionNode): boolean {
    for (const property of expression.properties) {
        if (property.type === 'SpreadElement') return true;
    }
    return false;
}

/**
 * Emits the oxc runtime fallback for one unresolved sz expression.
 *
 * @param params Runtime fallback inputs.
 * @returns Whether runtime fallback was emitted.
 */
function transformOxcRuntimeFallback(params: OxcRuntimeFallbackParams): boolean {
    const {
        expression,
        attribute,
        attributes,
        classNameAttribute,
        filename,
        bindings,
        source,
        edits,
        classes,
        diagnostics,
    } = params;
    if (!expression || !attribute) return false;
    if (expression.type !== 'ArrayExpression') {
        diagnostics.push(buildRuntimeFallbackDiagnostic(expression, source));
    }
    if (
        expression.type === 'ObjectExpression' &&
        hasOxcTopLevelSpread(expression as ObjectExpressionNode)
    ) {
        const { line, column } = offsetToLineColumn(source, expression.start);
        diagnostics.push(
            `[csszyx] unresolvable sz spread at ${line}:${column + 1}: ` +
                'sz={{ ...x }} cannot be resolved at build time and falls back to runtime; ' +
                'it may render no styles in production. Use array form: sz={[x, { ... }]}.',
        );
    }
    collectCandidateClassesFromExpression(expression, filename, bindings, classes, '');
    const expressionSource = source.slice(expression.start, expression.end);
    if (classNameAttribute) {
        // Formerly a D2.5+ bail to the Babel lane (one WARN per file — 25 on
        // one field report). Same emit as Babel and the rust engine: the
        // existing className merges with the runtime-resolved sz value.
        const existing = classNameMergeArgument(classNameAttribute, source);
        edits.overwrite(
            classNameAttribute.start,
            classNameAttribute.end,
            `className={_szMerge(${existing}, _sz(${expressionSource}))}`,
        );
        removeOxcAttributes(attributes, source, edits);
        return true;
    }
    edits.overwrite(attribute.start, attribute.end, `className={_sz(${expressionSource})}`);
    for (const szAttribute of attributes) {
        if (szAttribute === attribute) continue;
        edits.remove(whitespaceStart(source, szAttribute.start), szAttribute.end);
    }
    return true;
}

/** Inputs required to lower one unresolved oxc sz expression. */
interface OxcRuntimeFallbackParams {
    readonly expression: OxcNode | null;
    readonly attribute: JsxAttributeNode | null;
    readonly attributes: JsxAttributeNode[];
    readonly classNameAttribute: JsxAttributeNode | null;
    readonly filename: string;
    readonly bindings: Map<string, ObjectExpressionNode>;
    readonly source: string;
    readonly edits: MagicString;
    readonly classes: Set<string>;
    readonly diagnostics: string[];
}

/** Relevant attributes collected from one oxc JSX opening element. */
interface OxcOpeningAttributes {
    sz: JsxAttributeNode[];
    szs: JsxAttributeNode[];
    className: JsxAttributeNode | null;
    style: JsxAttributeNode | null;
    recovery: JsxAttributeNode | null;
    alreadyTagged: boolean;
    hasSpread: boolean;
    spreads: OxcNode[];
    last: JsxAttributeNode | null;
}

/**
 * Builds the shared style-spread collision diagnostic.
 *
 * @param filename Source filename.
 * @returns Actionable collision diagnostic.
 */
function styleSpreadCollisionDiagnostic(filename: string): string {
    return (
        `[csszyx] possible style override at ${filename}: ` +
        'this element spreads props that may contain style, while sz emits an explicit style attribute. ' +
        'Move the spread style to an explicit style prop so csszyx can merge both values.'
    );
}

/** Source rewrite that moves generated style props into one safe JSX spread. */
interface OxcSafeStyleSpreadRewrite {
    start: number;
    end: number;
    replacement: string;
}

/**
 * Reports whether generated style still collides with an unresolved prop spread.
 * @param hasSpread Whether the opening element contains any prop spread.
 * @param rewrite Proven-safe spread rewrite, when available.
 * @returns Whether the collision diagnostic remains necessary.
 */
function hasUnresolvedStyleSpread(
    hasSpread: boolean,
    rewrite: OxcSafeStyleSpreadRewrite | null,
): boolean {
    return hasSpread && !rewrite;
}

/**
 * Appends one source fragment before an object literal's closing brace.
 * @param objectSource Complete object literal source.
 * @param hasProperties Whether the object already has members.
 * @param propertySource Property source to append.
 * @returns Rebuilt object source, or null for a malformed span.
 */
function appendOxcObjectProperty(
    objectSource: string,
    hasProperties: boolean,
    propertySource: string,
): string | null {
    if (!objectSource.endsWith('}')) return null;
    const body = objectSource.slice(0, -1);
    let separator = '';
    if (hasProperties) separator = body.trimEnd().endsWith(',') ? ' ' : ', ';
    return `${body}${separator}${propertySource}}`;
}

/**
 * Rebuilds an object literal with generated custom properties inside `style`.
 * @param object Object-literal spread branch.
 * @param styleProps Generated style property source.
 * @param source Original source.
 * @returns Rewritten object source, or null when the branch is unsafe.
 */
function buildOxcStyleSpreadObject(
    object: ObjectExpressionNode,
    styleProps: string,
    source: string,
): string | null {
    if (
        object.properties.some(
            property =>
                property.type === 'SpreadElement' ||
                (property.type === 'Property' && (property as PropertyNode).computed),
        )
    ) {
        return null;
    }
    const styles = object.properties.filter(property => {
        if (property.type !== 'Property') return false;
        const candidate = property as PropertyNode;
        return !candidate.computed && extractKeyName(candidate.key) === 'style';
    }) as PropertyNode[];
    if (styles.length > 1) return null;

    const objectSource = source.slice(object.start, object.end);
    const style = styles[0];
    if (!style) {
        return appendOxcObjectProperty(
            objectSource,
            object.properties.length > 0,
            `style: {${styleProps}}`,
        );
    }

    const value = unwrapExpression(style.value);
    let replacement: string;
    if (value.type === 'ObjectExpression') {
        const styleObject = value as ObjectExpressionNode;
        const styleSource = source.slice(styleObject.start, styleObject.end);
        const appended = appendOxcObjectProperty(
            styleSource,
            styleObject.properties.length > 0,
            styleProps,
        );
        if (!appended) return null;
        replacement = appended;
    } else {
        replacement = `{...(${source.slice(value.start, value.end)}), ${styleProps}}`;
    }
    const relativeStart = value.start - object.start;
    const relativeEnd = value.end - object.start;
    return `${objectSource.slice(0, relativeStart)}${replacement}${objectSource.slice(relativeEnd)}`;
}

/**
 * Builds a single-evaluation rewrite for object or object-branch JSX spreads.
 * @param spreads JSX spread attributes on the opening element.
 * @param styleAttr Existing explicit style attribute.
 * @param styleProps Generated style property fragments.
 * @param source Original source.
 * @returns Safe spread rewrite, or null when explicit style emission is required.
 */
function buildOxcSafeStyleSpreadRewrite(
    spreads: readonly OxcNode[],
    styleAttr: JsxAttributeNode | null,
    styleProps: readonly string[],
    source: string,
): OxcSafeStyleSpreadRewrite | null {
    if (spreads.length !== 1 || styleAttr || styleProps.length === 0) return null;
    const spread = spreads[0] as OxcNode & { argument?: OxcNode };
    if (!spread.argument) return null;
    const argument = unwrapExpression(spread.argument);
    const propsSource = styleProps.join(', ');
    let expressionSource: string | null = null;
    if (argument.type === 'ObjectExpression') {
        expressionSource = buildOxcStyleSpreadObject(
            argument as ObjectExpressionNode,
            propsSource,
            source,
        );
    } else if (argument.type === 'ConditionalExpression') {
        const conditional = argument as ConditionalExpressionNode;
        const consequent = unwrapExpression(conditional.consequent);
        const alternate = unwrapExpression(conditional.alternate);
        if (consequent.type !== 'ObjectExpression' || alternate.type !== 'ObjectExpression') {
            return null;
        }
        const consequentSource = buildOxcStyleSpreadObject(
            consequent as ObjectExpressionNode,
            propsSource,
            source,
        );
        const alternateSource = buildOxcStyleSpreadObject(
            alternate as ObjectExpressionNode,
            propsSource,
            source,
        );
        if (!consequentSource || !alternateSource) return null;
        expressionSource = `(${source.slice(conditional.test.start, conditional.test.end)} ? ${consequentSource} : ${alternateSource})`;
    }
    if (!expressionSource) return null;
    return {
        start: spread.start,
        end: spread.end,
        replacement: `{...${expressionSource}}`,
    };
}

/**
 * Warns when generated oxc style props may override style from a prop spread.
 *
 * @param styleProperties Generated inline style properties.
 * @param hasSpread Whether the opening element spreads props.
 * @param filename Source filename.
 * @param diagnostics Compiler diagnostics.
 */
function warnOxcStyleSpreadCollision(
    styleProperties: readonly string[],
    hasSpread: boolean,
    filename: string,
    diagnostics: string[],
): void {
    if (styleProperties.length === 0 || !hasSpread) return;
    diagnostics.push(styleSpreadCollisionDiagnostic(filename));
}

/**
 * Collects relevant attributes from one oxc JSX opening element.
 *
 * @param attributes Raw opening-element attributes.
 * @returns Classified attributes and recovery metadata.
 */
function collectOxcOpeningAttributes(attributes: OxcNode[]): OxcOpeningAttributes {
    const collected: OxcOpeningAttributes = {
        sz: [],
        szs: [],
        className: null,
        style: null,
        recovery: null,
        alreadyTagged: false,
        hasSpread: false,
        spreads: [],
        last: null,
    };
    for (const rawAttribute of attributes) {
        if (rawAttribute.type !== 'JSXAttribute') {
            collected.hasSpread = true;
            collected.spreads.push(rawAttribute);
            continue;
        }
        const attribute = rawAttribute as JsxAttributeNode;
        collected.last = attribute;
        const name = attribute.name?.name;
        if (name === 'sz') collected.sz.push(attribute);
        else if (name === 'szs') collected.szs.push(attribute);
        else if (name === 'className' || name === 'class') collected.className = attribute;
        else if (name === 'style') collected.style = attribute;
        else if (name === 'szRecover') collected.recovery = attribute;
        else if (name === 'data-sz-recovery-token') collected.alreadyTagged = true;
    }
    return collected;
}

/**
 * Emits one validated inline recovery token.
 *
 * @param params Recovery attribute inputs.
 * @returns Whether a token was emitted.
 */
function transformOxcRecoveryAttribute(params: OxcRecoveryAttributeParams): boolean {
    const {
        attribute,
        alreadyTagged,
        lastAttribute,
        openingNode,
        filename,
        source,
        edits,
        diagnostics,
        recoveryTokens,
    } = params;
    if (!attribute || alreadyTagged) return false;
    const recoveryValue = stringLiteralValue(attribute.value);
    if (recoveryValue === null) {
        diagnostics.push(
            `[csszyx] szRecover at ${filename}: ` +
                'only string-literal values ("csr" | "dev-only") are supported. ' +
                'Dynamic values disable token emission for this element.',
        );
        return false;
    }
    if (!isValidInlineRecoveryMode(recoveryValue)) {
        diagnostics.push(
            `[csszyx] szRecover at ${filename}: ` +
                `unknown mode "${recoveryValue}" — expected "csr" or "dev-only". ` +
                'Token emission skipped.',
        );
        return false;
    }

    const elementType = extractElementName(openingNode.name);
    const { line, column } = offsetToLineColumn(source, attribute.start);
    const token = generateInlineRecoveryToken(filename, line, column, elementType);
    if (lastAttribute) {
        edits.appendRight(lastAttribute.end, ` data-sz-recovery-token="${token}"`);
    }
    recoveryTokens.set(token, {
        mode: recoveryValue,
        component: elementType,
        path: `${filename}:${line}:${column}`,
    });
    return true;
}

/** Inputs required to validate and emit one oxc recovery attribute. */
interface OxcRecoveryAttributeParams {
    readonly attribute: JsxAttributeNode | null;
    readonly alreadyTagged: boolean;
    readonly lastAttribute: JsxAttributeNode | null;
    readonly openingNode: JsxOpeningElementNode;
    readonly filename: string;
    readonly source: string;
    readonly edits: MagicString;
    readonly diagnostics: string[];
    readonly recoveryTokens: Map<string, TokenData>;
}

/**
 * Adds a literal oxc class attribute to Tailwind discovery.
 *
 * @param attribute Existing class attribute.
 * @param rawClassNames Tailwind raw-class discovery set.
 */
function collectOxcRawClassName(
    attribute: JsxAttributeNode | null,
    rawClassNames: Set<string>,
): void {
    if (!attribute) return;
    const value = stringLiteralValue(attribute.value);
    if (value === null) return;
    for (const className of value.split(/\s+/)) {
        if (className) rawClassNames.add(className);
    }
}

/** One compiled oxc szs slot entry. */
interface OxcSzsEntry {
    keyText: string;
    classNames: string;
    text: string;
}

/**
 * Compiles every validated slot entry without editing source.
 *
 * @param slotMap Validated szs slot map.
 * @param filename Source filename.
 * @param bindings Static object bindings.
 * @param source Original source.
 * @param globalVarAliases Global CSS variable aliases.
 * @param cssVariableMap Emitted CSS variable mapping.
 * @returns Compiled entries.
 */
function compileOxcSzsEntries(
    slotMap: ObjectExpressionNode,
    filename: string,
    bindings: Map<string, ObjectExpressionNode>,
    source: string,
    globalVarAliases: Map<string, string>,
    cssVariableMap: Map<string, CssVariableMangleValue>,
): OxcSzsEntry[] {
    const entries: OxcSzsEntry[] = [];
    for (const propertyNode of slotMap.properties) {
        const property = propertyNode as PropertyNode;
        const keyText = source.slice(property.key.start, property.key.end);
        const literal =
            property.value.type === 'Literal'
                ? (property.value as unknown as { value: unknown }).value
                : null;
        if (typeof literal === 'string') {
            entries.push({
                keyText,
                classNames: literal,
                text: source.slice(property.value.start, property.value.end),
            });
            continue;
        }
        // `isValidSzsSlotMap` has already proven the object uses only the
        // literal shapes understood by `astObjectToSzObject`.
        const slotObject = astObjectToSzObject(
            property.value as ObjectExpressionNode,
            filename,
            bindings,
        );
        const compiled = compileSzObject(
            applyGlobalVarAliasesToSzObject(slotObject, globalVarAliases, cssVariableMap),
        ).className;
        entries.push({ keyText, classNames: compiled, text: JSON.stringify(compiled) });
    }
    return entries;
}

/**
 * Compiles one oxc szs attribute.
 *
 * @param params szs attribute inputs.
 * @returns Whether the attribute was transformed.
 */
function transformOxcSzsAttribute(params: OxcSzsAttributeParams): boolean {
    const {
        attribute,
        openingNode,
        filename,
        rootDir,
        bindings,
        source,
        edits,
        diagnostics,
        pendingClasses,
        globalVarAliases,
        cssVariableMap,
    } = params;
    if (isHostOpeningElementName(openingNode.name as unknown as OxcNode)) {
        diagnostics.push(
            `[csszyx] szs at ${filename ?? '<anonymous>'}: ` +
                'szs has no effect on a host element — it maps slot names of a ' +
                'custom component. Attribute left unchanged.',
        );
        return false;
    }
    const value = attribute.value;
    const expression =
        value?.type === 'JSXExpressionContainer'
            ? (value as unknown as { expression: OxcNode }).expression
            : null;
    if (expression?.type !== 'ObjectExpression') {
        diagnostics.push(szsUnsupportedDiagnostic(filename ?? '<anonymous>'));
        return false;
    }
    const slotMap = expression as ObjectExpressionNode;
    if (!isValidSzsSlotMap(slotMap)) {
        diagnostics.push(szsUnsupportedDiagnostic(filename ?? '<anonymous>'));
        return false;
    }

    const { line } = offsetToLineColumn(source, attribute.start);
    setSzWarnLocation(formatSzWarnLocation(filename ?? 'file.tsx', line, rootDir));
    const entries = compileOxcSzsEntries(
        slotMap,
        // The compile path keeps the parser's default — only the szs
        // DIAGNOSTIC wording takes the shared '<anonymous>' fallback.
        filename ?? 'file.tsx',
        bindings,
        source,
        globalVarAliases,
        cssVariableMap,
    );
    setSzWarnLocation(undefined);
    const body = entries.map(entry => `${entry.keyText}: ${entry.text}`).join(', ');
    edits.overwrite(
        attribute.start,
        attribute.end,
        body === '' ? 'szsc={{}}' : `szsc={{ ${body} }}`,
    );
    for (const entry of entries) {
        for (const className of entry.classNames.split(/\s+/)) {
            if (className) pendingClasses.push(className);
        }
    }
    return true;
}

/**
 * Compiles all szs attributes on one opening element.
 *
 * @param params Opening-element szs inputs.
 * @returns Whether any attribute was transformed.
 */
function transformOxcSzsAttributes(params: OxcSzsAttributesParams): boolean {
    const { attributes, ...sharedParams } = params;
    let transformed = false;
    for (const attribute of attributes) {
        transformed =
            transformOxcSzsAttribute({
                attribute,
                ...sharedParams,
            }) || transformed;
    }
    return transformed;
}

/** Shared inputs for lowering szs attributes on one oxc opening element. */
interface OxcSzsTransformParams {
    readonly openingNode: JsxOpeningElementNode;
    readonly filename: string | undefined;
    readonly rootDir: string | undefined;
    readonly bindings: Map<string, ObjectExpressionNode>;
    readonly source: string;
    readonly edits: MagicString;
    readonly diagnostics: string[];
    readonly pendingClasses: string[];
    readonly globalVarAliases: Map<string, string>;
    readonly cssVariableMap: Map<string, CssVariableMangleValue>;
}

/** Inputs for lowering one szs attribute. */
interface OxcSzsAttributeParams extends OxcSzsTransformParams {
    readonly attribute: JsxAttributeNode;
}

/** Inputs for lowering all szs attributes on an opening element. */
interface OxcSzsAttributesParams extends OxcSzsTransformParams {
    readonly attributes: JsxAttributeNode[];
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
/**
 * Byte offsets where each line of {@link lineStartsSource} begins.
 *
 * One entry, rebuilt when a different source arrives. A file emits its
 * positions in a batch — several diagnostics per `sz` attribute — and rescanning
 * the prefix for each one made position lookup quadratic in file length. The
 * cache is filled on the FIRST lookup, never up front, so a file that reports
 * nothing pays nothing. Mirrors `LineIndex` in the Rust engine.
 */
let lineStarts: number[] | undefined;
/** Source the cached line starts were built from. */
let lineStartsSource: string | undefined;

/**
 * Convert a byte offset into 1-based line and 0-based column.
 *
 * @param source - Full source text the offset refers to.
 * @param offset - Offset to resolve.
 * @returns Line and column for the offset.
 */
function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
    if (lineStartsSource !== source || lineStarts === undefined) {
        const starts = [0];
        for (let i = 0; i < source.length; i++) {
            if (source.codePointAt(i) === 10) {
                starts.push(i + 1);
            }
        }
        lineStarts = starts;
        lineStartsSource = source;
    }
    const limit = Math.min(Math.max(offset, 0), source.length);
    // Highest line start at or before the offset. `lineStarts` always holds a
    // leading 0, so the search cannot fall below index 0.
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if ((lineStarts[mid] ?? 0) <= limit) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    return { line: low + 1, column: limit - (lineStarts[low] ?? 0) };
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
        'still safelisted best-effort).\n  Suggestion: use finite literal ternary branches ' +
        'when possible, or move truly runtime values to dynamic().'
    );
}

/** Whole-file accumulator for the szr import-rewrite proof (oxc lane). */
interface OxcSzrRewriteState {
    /** Span of the qualifying import's source literal, quotes included. */
    sourceSpan: { start: number; end: number } | null;
    /** The qualifying import's source value. */
    sourceValue: string;
    /** Span of the whole import declaration, for the clause split. */
    statementSpan: { start: number; end: number } | null;
    /** Spans of the OTHER named specifiers staying on the original source. */
    otherSpecifierSpans: Array<{ start: number; end: number }>;
    /** Direct `szr(...)` calls; the proof is deferred to the apply phase. */
    szrCalls: CallExpressionNode[];
    /** szr calls whose first argument was unresolvable during collection;
     * whether that is a real fallback is decided after the szv precompile. */
    pendingFallbacks: Array<{ call: CallExpressionNode; expression: OxcNode }>;
}

/** Verdict for one szr argument: shape plus the factory calls inside it. */
type OxcSzrArgumentAnalysis = SzrArgumentAnalysisOf<CallExpressionNode>;

/** One file-local `const F = szv(<config>)` factory candidate (oxc lane). */
interface OxcSzvFactoryCandidate {
    /** Factory binding name. */
    name: string;
    /** End offset of the declaration statement, for the table insertion. */
    statementEnd: number;
    /** Statically evaluated config, or null when extraction failed. */
    config: unknown;
}

/** Whole-file accumulator for the szv per-key precompile (oxc lane). */
type OxcSzvPrecompileState = SzvPrecompileState<
    CallExpressionNode,
    CallExpressionNode,
    OxcSzvFactoryCandidate
>;

/** Minimal import-declaration shape the proof reads. */
interface ImportDeclarationNode {
    importKind?: string;
    source: { value?: unknown; start: number; end: number };
    specifiers?: Array<{
        type: string;
        importKind?: string;
        imported?: { name?: string; value?: unknown };
        local?: { name?: string };
    }>;
}

/**
 * Record an import declaration when it is the rewritable szr clause.
 *
 * Same qualifying shape as the Babel lane: one value import of `szr`, no
 * alias, from a mapped source.
 *
 * @param node - The import declaration node.
 * @param state - Whole-file proof accumulator.
 */
function recordSzrImportCandidateOxc(node: OxcNode, state: OxcSzrRewriteState): void {
    const declaration = node as unknown as ImportDeclarationNode;
    if (declaration.importKind === 'type') return;
    const sourceValue = declaration.source?.value;
    if (typeof sourceValue !== 'string') return;
    if (SZR_IMPORT_REWRITE_TARGETS[sourceValue] === undefined) return;
    const specifiers = declaration.specifiers ?? [];
    let sawSzr = false;
    const others: Array<{ start: number; end: number }> = [];
    for (const specifier of specifiers) {
        // A default or namespace specifier makes the clause shape one this
        // rewrite does not rebuild — leave the whole declaration alone.
        if (specifier.type !== 'ImportSpecifier') return;
        const shaped = specifier as unknown as { start: number; end: number };
        const importedName = specifier.imported?.name ?? specifier.imported?.value;
        if (
            specifier.importKind !== 'type' &&
            importedName === 'szr' &&
            specifier.local?.name === 'szr'
        ) {
            sawSzr = true;
        } else {
            others.push({ start: shaped.start, end: shaped.end });
        }
    }
    if (!sawSzr) return;
    const statement = node as unknown as { start: number; end: number };
    state.sourceSpan = { start: declaration.source.start, end: declaration.source.end };
    state.sourceValue = sourceValue;
    state.statementSpan = { start: statement.start, end: statement.end };
    state.otherSpecifierSpans = others;
}

/**
 * Record one direct identifier-callee call for the deferred proofs.
 *
 * @param node - The call expression node.
 * @param szrState - szr import-rewrite accumulator.
 * @param szvState - szv precompile accumulator.
 */
function recordIdentifierCallOxc(
    node: CallExpressionNode,
    szrState: OxcSzrRewriteState,
    szvState: OxcSzvPrecompileState,
): void {
    const calleeName =
        node.callee.type === 'Identifier' ? (node.callee as IdentifierNode).name : null;
    recordIdentifierCallByName(node, calleeName, szrState.szrCalls, szvState);
}

/**
 * Record one `typeof X` type-query reference — erased at runtime, so it must
 * not fail the factory's reference accounting.
 *
 * @param node - The type-query node.
 * @param state - szv precompile accumulator.
 */
function recordSzvTypeQueryOxc(node: OxcNode, state: OxcSzvPrecompileState): void {
    const exprName = (node as unknown as { exprName?: { type: string; name?: string } }).exprName;
    recordSzvTypeQueryByName(
        exprName?.type === 'Identifier' ? (exprName.name ?? null) : null,
        state,
    );
}

/** Minimal variable-declaration shape the factory scan reads. */
interface VariableDeclarationNode {
    end: number;
    declarations?: Array<{
        id?: { type: string; name?: string };
        init?: OxcNode | null;
    }>;
}

/**
 * Record every `const F = szv(<object literal>)` declarator in one statement.
 *
 * @param node - The variable declaration node.
 * @param state - szv precompile accumulator.
 */
function recordSzvFactoryCandidatesOxc(node: OxcNode, state: OxcSzvPrecompileState): void {
    if (!state.enabled) return;
    const declaration = node as unknown as VariableDeclarationNode;
    for (const declarator of declaration.declarations ?? []) {
        if (declarator.id?.type !== 'Identifier' || !declarator.init) continue;
        const name = declarator.id.name;
        if (name === undefined || SZV_RESERVED_FACTORY_NAMES.has(name)) continue;
        if (state.candidates.has(name)) continue;
        const init = unwrapExpression(declarator.init);
        if (init.type !== 'CallExpression') continue;
        const call = init as CallExpressionNode;
        if (call.callee.type !== 'Identifier') continue;
        if ((call.callee as IdentifierNode).name !== 'szv') continue;
        if (call.arguments.length !== 1) continue;
        const argument = unwrapExpression(call.arguments[0] as OxcNode);
        const config =
            argument.type === 'ObjectExpression' ? evaluateStaticObjectOxc(argument) : null;
        state.candidates.set(name, { name, statementEnd: declaration.end, config });
    }
}

/**
 * Record factory candidates that arrive through imports, resolved by the
 * bundler's cross-module registry (oxc lane).
 *
 * @param node - The import declaration node.
 * @param state - szv precompile accumulator.
 */
function recordCrossModuleSzvFactoriesOxc(node: OxcNode, state: OxcSzvPrecompileState): void {
    const declaration = node as unknown as ImportDeclarationNode;
    const sourceValue = declaration.source?.value;
    const statement = node as unknown as { end: number };
    recordCrossModuleSzvFactoryImports(
        typeof sourceValue === 'string' ? sourceValue : null,
        declaration.importKind === 'type',
        (declaration.specifiers ?? []).map(specifier => {
            const importedName = specifier.imported?.name ?? specifier.imported?.value;
            return specifier.type === 'ImportSpecifier'
                ? {
                      importedName: typeof importedName === 'string' ? importedName : null,
                      localName: specifier.local?.name ?? null,
                      typeOnly: specifier.importKind === 'type',
                  }
                : { importedName: null, localName: null, typeOnly: false };
        }),
        state,
        (name, config) => ({
            name,
            statementEnd: statement.end,
            config,
        }),
    );
}

/**
 * See through parentheses, which Babel's parser drops.
 *
 * @param node - Any expression node.
 * @returns The innermost non-parenthesized expression.
 */
function unwrapParenthesizedOxc(node: OxcNode): OxcNode {
    let current = node;
    while (current.type === 'ParenthesizedExpression') {
        current = (current as unknown as { expression: OxcNode }).expression;
    }
    return current;
}

/**
 * Evaluate a fully literal object expression to a plain object.
 *
 * Strict on purpose: identifier/string keys only, no spread, no computed
 * keys, values limited to literals, `undefined`, negated numbers, arrays and
 * nested objects of the same. Anything else returns null and disqualifies.
 *
 * @param node - The object expression node.
 * @returns The plain object, or null when any part is not a literal.
 */
function evaluateStaticObjectOxc(node: OxcNode): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};
    const properties = (node as unknown as { properties: OxcNode[] }).properties ?? [];
    for (const property of properties) {
        if (property.type !== 'Property') return null;
        const shaped = property as unknown as {
            computed?: boolean;
            key: { type: string; name?: string; value?: unknown };
            value: OxcNode;
        };
        if (shaped.computed) return null;
        let key: string | null = null;
        if (shaped.key.type === 'Identifier') {
            key = shaped.key.name ?? null;
        } else if (shaped.key.type === 'Literal' && typeof shaped.key.value === 'string') {
            key = shaped.key.value;
        } else if (shaped.key.type === 'Literal' && typeof shaped.key.value === 'number') {
            // Numeric keys stringify, matching the Babel and Rust extractors.
            key = String(shaped.key.value);
        }
        if (key === null) return null;
        const value = evaluateStaticValueOxc(shaped.value);
        if (value === STATIC_EVAL_FAILED) return null;
        result[key] = value;
    }
    return result;
}

/** Sentinel distinguishing "not static" from a legitimate undefined value. */
const STATIC_EVAL_FAILED: unique symbol = Symbol('static-eval-failed');

/**
 * Evaluate one fully literal value expression.
 *
 * EXACTLY the Babel lane's `evaluateStaticValue` vocabulary — string, number
 * and boolean literals, a negated number, and nested objects of the same. No
 * templates, identifiers or arrays: a broader evaluator here would let this
 * lane qualify a config Babel bails on, and a `build.parser` flip would then
 * change the emitted code.
 *
 * @param rawNode - The value node.
 * @returns The evaluated value, or the failure sentinel.
 */
function evaluateStaticValueOxc(rawNode: OxcNode): unknown {
    // TS wrappers unwrap here (Babel's evaluateStaticValue sees through them);
    // the szr ARGUMENT safety check deliberately does not.
    const node = unwrapExpression(rawNode);
    if (node.type === 'Literal') {
        const value = (node as unknown as { value: unknown }).value;
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? value
            : STATIC_EVAL_FAILED;
    }
    if (node.type === 'UnaryExpression') {
        const unary = node as unknown as { operator: string; argument: OxcNode };
        if (unary.operator !== '-') return STATIC_EVAL_FAILED;
        const inner = unwrapExpression(unary.argument);
        if (inner.type !== 'Literal') return STATIC_EVAL_FAILED;
        const value = (inner as unknown as { value: unknown }).value;
        return typeof value === 'number' ? -value : STATIC_EVAL_FAILED;
    }
    if (node.type === 'ObjectExpression') {
        return evaluateStaticObjectOxc(node) ?? STATIC_EVAL_FAILED;
    }
    return STATIC_EVAL_FAILED;
}

/**
 * Plan and apply the szv per-key precompile for one file (oxc lane).
 *
 * Same decision procedure as the Babel lane; the mechanics are span splices
 * instead of node mutation, so replaced call nodes are tracked by identity for
 * the szr proof that runs after.
 *
 * @param state - szv precompile accumulator.
 * @param szrState - szr accumulator (for argument-position checks).
 * @param source - Original file text.
 * @param edits - MagicString over the source.
 * @returns Whether any rewrite was applied.
 */
function applySzvPrecompileOxc(
    state: OxcSzvPrecompileState,
    szrState: OxcSzrRewriteState,
    source: string,
    edits: MagicString,
): boolean {
    // Analyze every szr argument ONCE — the analyses drive factory accounting,
    // the szr proof, and the deferred fallbacks.
    for (const call of szrState.szrCalls) {
        const analyses: OxcSzrArgumentAnalysis[] = call.arguments.map(argument => {
            const factories: CallExpressionNode[] = [];
            const shapeOk = analyzeSzrArgumentOxc(argument as OxcNode, factories);
            return { shapeOk, factories };
        });
        state.szrArgumentAnalyses.set(call, analyses);
    }
    if (state.candidates.size === 0) return false;
    const szrArgumentNodes = new Set<unknown>();
    for (const analyses of state.szrArgumentAnalyses.values()) {
        for (const analysis of analyses) {
            for (const factory of analysis.factories) {
                szrArgumentNodes.add(factory);
            }
        }
    }

    let rewrote = false;
    for (const candidate of state.candidates.values()) {
        const table = candidate.config === null ? null : qualifyStaticSzvConfig(candidate.config);
        if (table === null) continue;
        const calls = state.identifierCalls.get(candidate.name) ?? [];
        if (
            !szvFactoryAccountingHolds(
                candidate.name,
                calls,
                szrArgumentNodes,
                source,
                state.commentSpans,
                state.typeQueryCounts,
            )
        ) {
            continue;
        }

        let pickNeeded = false;
        let pick1Needed = false;
        for (const call of calls) {
            const shaped = call as unknown as { start: number; end: number };
            const replacement = planSzvCallReplacementOxc(call, table, source);
            if (replacement.kind === 'static') {
                edits.overwrite(shaped.start, shaped.end, JSON.stringify(replacement.value));
            } else if (replacement.kind === 'dynamic1') {
                pick1Needed = true;
                edits.overwrite(
                    shaped.start,
                    shaped.end,
                    `__szvPick1(${szvTableIdentifier(candidate.name)}, ${JSON.stringify(replacement.dimension)}, ${replacement.valueText})`,
                );
            } else {
                pickNeeded = true;
                edits.overwrite(
                    shaped.start,
                    shaped.end,
                    `__szvPick(${szvTableIdentifier(candidate.name)}, ${replacement.selectionText})`,
                );
            }
            state.replacedCalls.add(call);
            rewrote = true;
        }
        if (pickNeeded || pick1Needed) {
            edits.appendRight(
                candidate.statementEnd,
                `\nconst ${szvTableIdentifier(candidate.name)} = ${serializeSzvTable(table)};`,
            );
            if (pickNeeded) state.usedPick = true;
            if (pick1Needed) state.usedPick1 = true;
        }
    }
    return rewrote;
}

/** Planned replacement for one factory call site (oxc lane). */
type OxcSzvCallReplacement =
    | { kind: 'static'; value: string }
    | { kind: 'dynamic1'; dimension: string; valueText: string }
    | { kind: 'dynamic'; selectionText: string };

/**
 * Decide how one factory call collapses (oxc lane).
 *
 * @param call - The `F(selection?)` call.
 * @param table - The factory's compiled table.
 * @param source - Original file text, for the dynamic selection splice.
 * @returns A build-time string, or a dynamic pick over the original text.
 */
function planSzvCallReplacementOxc(
    call: CallExpressionNode,
    table: SzvPrecompiledTable,
    source: string,
): OxcSzvCallReplacement {
    if (call.arguments.length === 0) {
        return { kind: 'static', value: computeStaticSzvPick(table, undefined) };
    }
    const argument = unwrapParenthesizedOxc(call.arguments[0] as OxcNode);
    if (argument.type === 'ObjectExpression') {
        const selection = evaluateStaticSzvSelectionOxc(argument);
        if (selection !== null) {
            return { kind: 'static', value: computeStaticSzvPick(table, selection) };
        }
        const single = planSingleDimensionPickOxc(argument, table, source);
        if (single !== null) {
            return single;
        }
    }
    const shaped = argument as unknown as { start: number; end: number };
    return { kind: 'dynamic', selectionText: source.slice(shaped.start, shaped.end) };
}

/**
 * Plan the single-dimension pick for a selection literal naming exactly one
 * known variant (oxc lane) — mirror of the Babel lane's `planSingleDimensionPick`.
 *
 * @param node - The selection object expression.
 * @param table - The factory's compiled table.
 * @param source - Original file text, for the value splice.
 * @returns The planned single-dimension pick, or null when it does not apply.
 */
function planSingleDimensionPickOxc(
    node: OxcNode,
    table: SzvPrecompiledTable,
    source: string,
): { kind: 'dynamic1'; dimension: string; valueText: string } | null {
    const properties = (node as unknown as { properties: OxcNode[] }).properties ?? [];
    if (properties.length !== 1) return null;
    const property = properties[0];
    if (property.type !== 'Property') return null;
    const shaped = property as unknown as {
        computed?: boolean;
        key: { type: string; name?: string; value?: unknown };
        value: OxcNode;
    };
    if (shaped.computed) return null;
    // Identifier and string keys only, matching the Babel lane — a numeric key
    // bails on both, so the two lanes cannot reach different verdicts.
    const key = staticSzvSelectionKeyOxc(shaped.key);
    // The defaults / __proto__ / own-property rules live in the shared spec —
    // both lanes must reach the same verdict.
    if (!singleDimensionPickAllowed(table, key)) return null;
    const value = shaped.value as unknown as { start: number; end: number };
    return { kind: 'dynamic1', dimension: key, valueText: source.slice(value.start, value.end) };
}

/**
 * Evaluate a selection object literal when it is fully static and primitive.
 *
 * @param node - The selection object expression.
 * @returns The plain selection, or null when any part is not a literal.
 */
function evaluateStaticSzvSelectionOxc(node: OxcNode): StaticSzvSelection | null {
    const evaluated = evaluateStaticObjectOxc(node);
    if (evaluated === null) return null;
    const selection: StaticSzvSelection = {};
    for (const key of Object.keys(evaluated)) {
        // The value-domain rule (string / boolean / safe integer) lives in the
        // shared spec so both lanes coerce identically.
        const coerced = coerceParitySafeSelectionValue(evaluated[key]);
        if (coerced === null) return null;
        selection[key] = coerced;
    }
    return selection;
}

/**
 * Read the identifier/string key vocabulary shared by static szv selections.
 *
 * @param key - Oxc property key to classify.
 * @param key.type - Oxc node type.
 * @param key.name - Identifier text when present.
 * @param key.value - Literal value when present.
 * @returns The static key text, or null for unsupported key shapes.
 */
function staticSzvSelectionKeyOxc(key: {
    type: string;
    name?: string;
    value?: unknown;
}): string | null {
    if (key.type === 'Identifier') return key.name ?? null;
    if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
    return null;
}

/**
 * Whether an expression can never evaluate to a truthy non-string.
 *
 * Mirror of the Babel lane's check over oxc node shapes. Parentheses are
 * unwrapped because Babel's parser drops them — the two lanes must reach the
 * same verdict or a `build.parser` flip would change the emitted import.
 *
 * @param rawExpression - Argument expression.
 * @returns True when the value provably needs no object lowering.
 */
function isProvablyNonObjectArgumentOxc(rawExpression: OxcNode): boolean {
    let expression = rawExpression;
    while (expression.type === 'ParenthesizedExpression') {
        expression = (expression as unknown as { expression: OxcNode }).expression;
    }
    if (expression.type === 'Literal') {
        const value = (expression as unknown as { value: unknown }).value;
        return typeof value === 'string' || value === false || value === null;
    }
    if (expression.type === 'TemplateLiteral') return true;
    if (expression.type === 'Identifier') {
        return (expression as IdentifierNode).name === 'undefined';
    }
    if (expression.type === 'LogicalExpression') {
        const logical = expression as unknown as {
            operator: string;
            left: OxcNode;
            right: OxcNode;
        };
        if (logical.operator === '&&') return isProvablyNonObjectArgumentOxc(logical.right);
        return (
            isProvablyNonObjectArgumentOxc(logical.left) &&
            isProvablyNonObjectArgumentOxc(logical.right)
        );
    }
    if (expression.type === 'ConditionalExpression') {
        const conditional = expression as unknown as { consequent: OxcNode; alternate: OxcNode };
        return (
            isProvablyNonObjectArgumentOxc(conditional.consequent) &&
            isProvablyNonObjectArgumentOxc(conditional.alternate)
        );
    }
    if (expression.type === 'ArrayExpression') {
        const elements = (expression as unknown as { elements: Array<OxcNode | null> }).elements;
        return elements.every(
            element =>
                element !== null &&
                element.type !== 'SpreadElement' &&
                isProvablyNonObjectArgumentOxc(element),
        );
    }
    return false;
}

/**
 * Analyze one szr argument: provably string-or-falsy, allowing identifier
 * factory calls as leaves.
 *
 * Mirror of the Babel lane's walk over oxc node shapes. The collected factory
 * calls are candidates only — the argument is proven when the shape holds AND
 * every collected call was rewritten by the szv precompile.
 *
 * @param rawExpression - Argument expression.
 * @param factories - Sink for identifier-callee calls found at leaves.
 * @returns Whether the non-factory shape is provably string-or-falsy.
 */
function analyzeSzrArgumentOxc(rawExpression: OxcNode, factories: CallExpressionNode[]): boolean {
    let expression = rawExpression;
    while (expression.type === 'ParenthesizedExpression') {
        expression = (expression as unknown as { expression: OxcNode }).expression;
    }
    if (expression.type === 'CallExpression') {
        const call = expression as CallExpressionNode;
        if (
            call.callee.type === 'Identifier' &&
            !SZV_RESERVED_FACTORY_NAMES.has((call.callee as IdentifierNode).name)
        ) {
            factories.push(call);
            return true;
        }
        return false;
    }
    if (expression.type === 'Literal') {
        const value = (expression as unknown as { value: unknown }).value;
        return typeof value === 'string' || value === false || value === null;
    }
    if (expression.type === 'TemplateLiteral') return true;
    if (expression.type === 'Identifier') {
        return (expression as IdentifierNode).name === 'undefined';
    }
    if (expression.type === 'LogicalExpression') {
        const logical = expression as unknown as {
            operator: string;
            left: OxcNode;
            right: OxcNode;
        };
        if (logical.operator === '&&') return analyzeSzrArgumentOxc(logical.right, factories);
        return (
            analyzeSzrArgumentOxc(logical.left, factories) &&
            analyzeSzrArgumentOxc(logical.right, factories)
        );
    }
    if (expression.type === 'ConditionalExpression') {
        const conditional = expression as unknown as { consequent: OxcNode; alternate: OxcNode };
        return (
            analyzeSzrArgumentOxc(conditional.consequent, factories) &&
            analyzeSzrArgumentOxc(conditional.alternate, factories)
        );
    }
    if (expression.type === 'ArrayExpression') {
        const elements = (expression as unknown as { elements: Array<OxcNode | null> }).elements;
        return elements.every(
            element =>
                element !== null &&
                element.type !== 'SpreadElement' &&
                analyzeSzrArgumentOxc(element, factories),
        );
    }
    return false;
}

/**
 * Emit the deferred szr fallback diagnostics for arguments that stayed
 * unproven after the precompile.
 *
 * @param szrState - szr accumulator with the pending records.
 * @param szvState - szv accumulator with analyses and replacements.
 * @param source - Original file text, for position resolution.
 * @param diagnostics - Compiler diagnostics sink.
 */
function emitPendingSzrFallbacksOxc(
    szrState: OxcSzrRewriteState,
    szvState: OxcSzvPrecompileState,
    source: string,
    diagnostics: string[],
): void {
    emitUnprovenSzrFallbacks(
        szrState.pendingFallbacks,
        szvState.szrArgumentAnalyses,
        szvState.replacedCalls,
        expression => pushSiteFallbackDiagnostic(diagnostics, 'szr', expression, source),
    );
}

/**
 * Apply the rewrite when the whole-file proof holds.
 *
 * @param state - Whole-file proof accumulator.
 * @param szvState - szv precompile accumulator (replaced calls are strings).
 * @param source - Original file text, for reference accounting.
 * @param edits - MagicString over the source.
 * @returns Whether the specifier was overwritten.
 */
function applySzrImportRewriteOxc(
    state: OxcSzrRewriteState,
    szvState: OxcSzvPrecompileState,
    source: string,
    edits: MagicString,
): boolean {
    if (state.sourceSpan === null) return false;
    if (
        !szrRewriteProofHolds(
            state.szrCalls,
            szvState.szrArgumentAnalyses,
            szvState.replacedCalls,
            source,
            szvState.commentSpans,
        )
    ) {
        return false;
    }
    const target = SZR_IMPORT_REWRITE_TARGETS[state.sourceValue];
    // Preserve the author's quote character — the span covers it.
    const quote = source[state.sourceSpan.start] === '"' ? '"' : "'";
    if (state.otherSpecifierSpans.length === 0) {
        edits.overwrite(state.sourceSpan.start, state.sourceSpan.end, `${quote}${target}${quote}`);
        return true;
    }
    // Split the clause: rebuild the statement as the other specifiers on the
    // original source, then szr alone on the core entry. Rebuilding from the
    // specifier spans drops comments inside the clause; a comment mentioning
    // szr already failed the reference accounting above.
    if (state.statementSpan === null) return false;
    const others = state.otherSpecifierSpans
        .map(span => source.slice(span.start, span.end))
        .join(', ');
    edits.overwrite(
        state.statementSpan.start,
        state.statementSpan.end,
        `import { ${others} } from ${quote}${state.sourceValue}${quote};\n` +
            `import { szr } from ${quote}${target}${quote};`,
    );
    return true;
}

/**
 * Record a build-time-unresolvable construct through the shared matrix.
 *
 * @param diagnostics Compiler diagnostics sink.
 * @param site Which construct hit the failure.
 * @param expression The expression that could not be read.
 * @param source Original source, for position resolution.
 */
function pushSiteFallbackDiagnostic(
    diagnostics: string[],
    site: SzFallbackSite,
    expression: OxcNode | undefined,
    source: string,
): void {
    if (!expression) return;
    // Babel drops parenthesized-expression nodes, so position and wording both
    // point at the inner expression on that lane. Keep oxc byte-identical.
    let positionedExpression = expression;
    while (positionedExpression.type === 'ParenthesizedExpression') {
        positionedExpression = (positionedExpression as unknown as { expression: OxcNode })
            .expression;
    }
    const { line, column } = offsetToLineColumn(source, positionedExpression.start);
    const { kind, detail } = classifyFallbackExpression(expression);
    diagnostics.push(formatSzFallbackDiagnostic(site, `${line}:${column + 1}`, kind, detail));
}

/**
 * Classify an oxc expression into the shared matrix vocabulary.
 *
 * Parentheses are unwrapped because Babel's AST has no node for them; TS
 * wrappers are NOT, because Babel classifies those as `other`.
 *
 * @param rawExpression Unresolved expression.
 * @returns Matrix kind plus its interpolated detail.
 */
function classifyFallbackExpression(rawExpression: OxcNode): {
    kind: SzFallbackKind;
    detail: string;
} {
    let expression = rawExpression;
    while (expression.type === 'ParenthesizedExpression') {
        expression = (expression as unknown as { expression: OxcNode }).expression;
    }
    if (expression.type === 'CallExpression') {
        const callee = (expression as CallExpressionNode).callee;
        let name: string = SZ_FALLBACK_UNKNOWN_CALLEE;
        if (callee.type === 'Identifier') {
            name = (callee as IdentifierNode).name;
        } else if (
            callee.type === 'MemberExpression' &&
            ((callee as unknown as { property?: OxcNode }).property?.type ?? '') === 'Identifier'
        ) {
            name = String(
                ((callee as unknown as { property: OxcNode }).property as IdentifierNode).name,
            );
        }
        return { kind: 'call', detail: name };
    }
    if (expression.type === 'Identifier') {
        return { kind: 'identifier', detail: (expression as IdentifierNode).name };
    }
    if (expression.type === 'MemberExpression') return { kind: 'member', detail: '' };
    return { kind: 'other', detail: expression.type };
}

/**
 * Build the same dev diagnostic Babel emits when sz falls back to runtime.
 *
 * @param rawExpression Runtime fallback expression, parentheses included.
 * @param source Original source.
 * @returns Diagnostic string.
 */
function buildRuntimeFallbackDiagnostic(rawExpression: OxcNode, source: string): string {
    // Babel's AST has no parenthesized-expression nodes, so its lane reports
    // the inner expression for `sz={(cfg.x)}`. Unwrap here or the same source
    // classifies as `other`/ParenthesizedExpression under oxc — wording AND
    // position diverging on a pure parser-implementation detail.
    let expression = rawExpression;
    while (expression.type === 'ParenthesizedExpression') {
        expression = (expression as unknown as { expression: OxcNode }).expression;
    }
    const { line, column } = offsetToLineColumn(source, expression.start);
    const lineCol = `${line}:${column + 1}`;
    // Classify the oxc node, then defer the wording to the shared matrix — the
    // Babel and Rust lanes read the same entries, so a build that switches
    // `build.parser` cannot see the text change.
    let reason: string;
    let suggestion: string;
    if (expression.type === 'CallExpression') {
        const callee = (expression as CallExpressionNode).callee;
        let name: string = SZ_FALLBACK_UNKNOWN_CALLEE;
        if (callee.type === 'Identifier') {
            name = (callee as IdentifierNode).name;
        } else if (
            callee.type === 'MemberExpression' &&
            ((callee as unknown as { property?: OxcNode }).property?.type ?? '') === 'Identifier'
        ) {
            name = String(
                ((callee as unknown as { property: OxcNode }).property as IdentifierNode).name,
            );
        }
        ({ reason, suggestion } = describeSzFallback('call', name));
    } else if (expression.type === 'Identifier') {
        ({ reason, suggestion } = describeSzFallback(
            'identifier',
            (expression as IdentifierNode).name,
        ));
    } else if (expression.type === 'MemberExpression') {
        ({ reason, suggestion } = describeSzFallback('member'));
    } else {
        ({ reason, suggestion } = describeSzFallback('other', expression.type));
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
    skipClass?: boolean;
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
    /** JS expression carried inside `className={…}` — a plain JSON string for
     * fully static output, or the conditional template/ternary source. Merge
     * paths splice THIS into `_szMerge(existing, …)` so conditionals survive
     * an existing className. */
    classExpression: string;
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
    | {
          kind: 'ternary';
          baseClasses: string;
          testSource: string;
          consequentClasses: string;
          alternateClasses: string;
      }
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

    if (unwrapped.type === 'ConditionalExpression') {
        return (
            classifyTernaryArrayPart(unwrapped as ConditionalExpressionNode, context) ?? {
                kind: 'dyn',
                src: context.source.slice(element.start, element.end),
                node: element,
            }
        );
    }

    const objectNode = resolveObjectExpression(unwrapped, context.bindings);
    const sz = objectNode ? tryConvertArrayObject(objectNode, context) : null;
    if (sz) return { kind: 'obj', sz };
    if (objectNode) {
        const partial = classifyPartialObjectArrayPart(objectNode, context);
        if (partial) return partial;
    }
    return { kind: 'dyn', src: context.source.slice(element.start, element.end), node: element };
}

/**
 * Precompiles a finite ternary array element whose branches are static sz values.
 *
 * @param conditional - Conditional array element.
 * @param context - Shared transform state.
 * @returns A compiled ternary part, or null when either branch is dynamic.
 */
function classifyTernaryArrayPart(
    conditional: ConditionalExpressionNode,
    context: ArrayCompositionContext,
): ArrayCompositionPart | null {
    const consequent = resolveStaticClassString(
        conditional.consequent,
        context.filename,
        context.bindings,
        context.globalVarAliases,
        context.cssVariableMap,
    );
    const alternate = resolveStaticClassString(
        conditional.alternate,
        context.filename,
        context.bindings,
        context.globalVarAliases,
        context.cssVariableMap,
    );
    if (consequent === null || alternate === null) return null;
    return {
        kind: 'ternary',
        baseClasses: '',
        testSource: context.source.slice(conditional.test.start, conditional.test.end),
        consequentClasses: consequent,
        alternateClasses: alternate,
    };
}

/**
 * Precompiles one object array element with a finite conditional property.
 *
 * @param objectNode - Object array element.
 * @param context - Shared transform state.
 * @returns A compiled ternary part, or null when runtime values/styles remain.
 */
function classifyPartialObjectArrayPart(
    objectNode: ObjectExpressionNode,
    context: ArrayCompositionContext,
): ArrayCompositionPart | null {
    const partial = evaluatePartialObject(
        objectNode,
        context.filename,
        context.bindings,
        context.source,
        context.globalVarAliases,
        context.cssVariableMap,
    );
    if (!partial || partial.dynamicProps.size > 0 || partial.conditionalClasses.length !== 1) {
        return null;
    }
    const conditional = partial.conditionalClasses[0];
    const baseClasses = compileSzObject(
        applyGlobalVarAliasesToSzObject(
            partial.staticProps,
            context.globalVarAliases,
            context.cssVariableMap,
        ),
    ).className;
    return {
        kind: 'ternary',
        baseClasses,
        testSource: context.source.slice(conditional.test.start, conditional.test.end),
        consequentClasses: conditional.consequent,
        alternateClasses: conditional.alternate,
    };
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
    if (part.kind === 'ternary') {
        collectArrayCompositionClasses(part.baseClasses, context.classes);
        collectArrayCompositionClasses(part.consequentClasses, context.classes);
        collectArrayCompositionClasses(part.alternateClasses, context.classes);
        if (part.baseClasses) args.push(JSON.stringify(part.baseClasses));
        args.push(
            `${part.testSource} ? ${JSON.stringify(part.consequentClasses)} : ${JSON.stringify(part.alternateClasses)}`,
        );
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
    // Same safety vocabulary as the szr proof: a provably string-or-falsy
    // element never needs the object lowering at runtime.
    oxcSzPartArgsProvable &&= isProvablyNonObjectArgumentOxc(part.node);
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
        // Partially-static nested object under a PROPERTY key: walk it WITH
        // the parent key. The old keyless walk compiled `color: 'black'` as a
        // bare `{ color }` → a junk `text-black` candidate, while the class
        // the runtime actually produces (`bg-black/30`) never reached the
        // safelist. Color-opacity conditionals contribute their COMBINED
        // per-branch classes first, matching the rust collector.
        if (collectCandidateColorConditional(key, value, context)) return;
        collectCandidateKeyedObject([key], value, context);
    }
}

/**
 * Adds both combined branch classes of a color-opacity conditional sub-object
 * (`bg-black/30`, `bg-black/100`) to the candidates.
 *
 * @param key Parent color property key.
 * @param value Nested color-object literal.
 * @param context Candidate collection state.
 * @returns Whether the object was a color-opacity conditional.
 */
function collectCandidateColorConditional(
    key: string,
    value: ObjectExpressionNode,
    context: CandidateClassContext,
): boolean {
    const result = createPartialObjectResult();
    const partialContext: PartialObjectContext = {
        filename: context.filename,
        bindings: context.bindings,
        source: '',
        globalVarAliases: new Map(),
        cssVariableMap: undefined,
        variantChain: '',
    };
    if (!evaluatePartialColorConditional(key, value, partialContext, result)) return false;
    for (const entry of result.conditionalClasses) {
        addPrefixedCandidateClasses(entry.consequent, context);
        addPrefixedCandidateClasses(entry.alternate, context);
    }
    return true;
}

/**
 * Best-effort candidates for a nested object under a chain of PROPERTY keys:
 * each resolvable leaf (and each static conditional branch) compiles at its
 * full key path. Unresolvable members are skipped — candidates are a safelist
 * best-effort for runtime-fallback shapes, which always carry a diagnostic.
 *
 * @param path Property-key chain from the sz root down to this object.
 * @param node Nested object literal.
 * @param context Candidate collection state.
 */
function collectCandidateKeyedObject(
    path: readonly string[],
    node: ObjectExpressionNode,
    context: CandidateClassContext,
): void {
    for (const property of node.properties) {
        if (property.type !== 'Property') continue;
        const member = property as PropertyNode;
        if (member.computed) continue;
        const memberKey = extractKeyName(member.key);
        if (memberKey === null) continue;
        collectCandidateKeyedValue([...path, memberKey], unwrapExpression(member.value), context);
    }
}

/**
 * Dispatches one keyed-object member value: recurse into objects, take both
 * static branches of conditionals, and compile static literals at their path.
 *
 * @param memberPath Property-key chain down to this value.
 * @param value Unwrapped member value.
 * @param context Candidate collection state.
 */
function collectCandidateKeyedValue(
    memberPath: readonly string[],
    value: OxcNode,
    context: CandidateClassContext,
): void {
    if (value.type === 'ObjectExpression') {
        collectCandidateKeyedObject(memberPath, value as ObjectExpressionNode, context);
        return;
    }
    if (value.type === 'ConditionalExpression') {
        const conditional = value as ConditionalExpressionNode;
        for (const branch of [conditional.consequent, conditional.alternate]) {
            const literal = extractStaticLiteralValue(branch);
            if (literal !== null) collectCandidateKeyedLeaf(memberPath, literal, context);
        }
        return;
    }
    const literal = extractStaticLiteralValue(value);
    if (literal !== null) collectCandidateKeyedLeaf(memberPath, literal, context);
}

/**
 * Compiles one static leaf at its full key path into candidate classes.
 *
 * @param subPath Property-key chain down to the leaf.
 * @param literal Static leaf value.
 * @param context Candidate collection state.
 */
function collectCandidateKeyedLeaf(
    subPath: readonly string[],
    literal: string | number | boolean,
    context: CandidateClassContext,
): void {
    let wrapped: unknown = literal;
    for (let index = subPath.length - 1; index >= 0; index--) {
        wrapped = { [subPath[index]]: wrapped };
    }
    try {
        addPrefixedCandidateClasses(compileSzObject(wrapped as SzObject).className, context);
    } catch {
        // Best-effort — a value the compiler rejects contributes nothing.
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
 * @param szrState szr accumulator for deferred fallback records.
 */
function collectDynamicCallClasses(
    node: CallExpressionNode,
    filename: string,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    classes: Set<string>,
    szrState: OxcSzrRewriteState,
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
        // `szr` compiles its literal argument so the classes reach the
        // safelist; an argument it cannot read means those classes are never
        // collected and the CSS is simply absent. `dynamic()` is exempt — it
        // injects its own rules at runtime, which is the whole point of it.
        // The diagnostic itself is DEFERRED: whether this argument is a real
        // fallback depends on the szv precompile, decided in the apply phase.
        if (calleeName === 'szr') {
            szrState.pendingFallbacks.push({ call: node, expression: firstArg as OxcNode });
        }
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
 * @param source Original source, for position resolution.
 * @param diagnostics Compiler diagnostics sink.
 */
function collectSzvCallClasses(
    node: CallExpressionNode,
    bindings: ReadonlyMap<string, ObjectExpressionNode>,
    constInits: ReadonlyMap<string, OxcNode>,
    classes: Set<string>,
    source: string,
    diagnostics: string[],
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
        // No catalogue is emitted, so none of the variant classes are
        // safelisted — under Tailwind `source(none)` that is silently missing
        // CSS for every variant the factory can produce.
        pushSiteFallbackDiagnostic(diagnostics, 'szv', firstArg as OxcNode, source);
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

/** Inputs required to lower one partially-static Oxc sz object. */
interface OxcPartialTransformContext {
    node: ObjectExpressionNode;
    filename: string;
    bindings: ReadonlyMap<string, ObjectExpressionNode>;
    source: string;
    options?: TransformSourceCodeOptions;
    hoistedNames?: ReadonlyMap<string, string>;
    cssVariableMap?: Map<string, CssVariableMangleValue>;
    reservedNames?: ReadonlySet<string>;
    globalVarAliases: ReadonlyMap<string, string>;
}

/**
 * Build className/style fragments for a sz object with static and dynamic values.
 *
 * @param context Object AST, source state, and CSS-variable planning inputs.
 * @returns Transform fragments, or null when the object needs runtime fallback.
 */
function buildPartialObjectTransform(
    context: OxcPartialTransformContext,
): OxcPartialTransform | null {
    const {
        node,
        filename,
        bindings,
        source,
        options,
        hoistedNames,
        cssVariableMap,
        reservedNames,
        globalVarAliases,
    } = context;
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
    // Conditional props coexist with static props AND runtime css vars —
    // statics and var classes lead, each conditional appends one template
    // segment (matching the Babel engine). This used to accept only a single
    // conditional with no vars and punt the rest to the runtime, which never
    // safelists the var utilities.

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
        refreshNullableDynamicConditional(partial);
    }

    for (const [, info] of partial.dynamicProps) {
        if (!info.skipClass) classParts.push(buildCSSVarClassName(info));
    }
    for (const entry of partial.conditionalClasses) {
        classParts.push(entry.consequent, entry.alternate);
    }

    const className = classParts.filter(Boolean).join(' ');
    let classNameAttr = staticOxcClassNameAttribute(className);
    let classExpression = JSON.stringify(className);
    if (partial.conditionalClasses.length > 0) {
        classExpression = buildConditionalClassSource(
            classParts,
            partial.conditionalClasses,
            source,
        );
        classNameAttr = `className={${classExpression}}`;
    } else if (className === '') {
        // An sz that lowers to zero classes emits undefined so the DOM has no
        // class attribute, instead of the noisy class="".
        classNameAttr = 'className={undefined}';
    }
    const styleProps = [...partial.dynamicProps.entries()]
        .filter(([id]) => !hoistedNames?.has(id))
        .map(
            ([, info]) =>
                `${JSON.stringify(info.varName)}: ${generateStyleValueSource(info, source)}`,
        );
    return {
        className,
        classNameAttr,
        classExpression,
        styleProps,
        usesColorVar: partial.usesColorVar,
        usesSpacingVar: partial.usesSpacingVar,
        usesUnitVar: partial.usesUnitVar,
        hasConditional: partial.conditionalClasses.length > 0,
    };
}

/**
 * Refreshes a nullable conditional utility after CSS variable name planning.
 *
 * @param partial Partially evaluated object with planned variable names.
 */
function refreshNullableDynamicConditional(partial: OxcPartialObjectResult): void {
    const info = [...partial.dynamicProps.values()].find(candidate => candidate.skipClass);
    const conditional = partial.conditionalClasses[0];
    if (!info || !conditional) return;
    const className = buildCSSVarClassName(info);
    if (conditional.consequent) conditional.consequent = className;
    if (conditional.alternate) conditional.alternate = className;
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
    let entries: Iterable<[string, string]>;
    if (input instanceof Map) entries = input.entries();
    else if (Array.isArray(input)) entries = input;
    else entries = Object.entries(input);
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
    const firstCharacter = name.charAt(0);
    return firstCharacter !== '' && name.startsWith(firstCharacter.toLowerCase());
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
    // An oxc object-expression member is a Property whenever it is not a spread.
    const objectProperty = property as PropertyNode;
    const key = objectProperty.computed ? null : extractKeyName(objectProperty.key);
    if (key === null) return false;

    const value = unwrapExpression(objectProperty.value);
    if (tryEvaluateStaticPartialProperty(key, value, context, result)) return true;
    if (value.type === 'ObjectExpression' && isKnownVariant(key)) {
        return evaluateNestedPartialVariant(key, value as ObjectExpressionNode, context, result);
    }
    if (
        value.type === 'ObjectExpression' &&
        evaluatePartialColorConditional(key, value as ObjectExpressionNode, context, result)
    ) {
        return true;
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
 * Compiles a color-opacity sub-object with a finite conditional on exactly one
 * of `color`/`op` into a conditional-classes entry whose branches are complete
 * color-opacity classes (`bg-black/30` | `bg-black/100`) — the rust engine's
 * static expansion. Kept over a runtime variable so the lanes agree on class
 * NAMES (cross-parser cache and mangle-map stability).
 *
 * @param key Parent color property key.
 * @param object Nested color-object literal.
 * @param context Shared evaluation inputs.
 * @param result Mutable partial result.
 * @returns Whether a conditional entry was emitted.
 */
function evaluatePartialColorConditional(
    key: string,
    object: ObjectExpressionNode,
    context: PartialObjectContext,
    result: OxcPartialObjectResult,
): boolean {
    const members = scanColorOpMembers(object);
    if (!members) return false;
    const { staticColor, colorConditional, staticOp, opConditional } = members;

    const compileBranch: ColorOpacityBranchCompiler = (color, op) => {
        const value = op === null ? { color } : { color, op };
        const aliased = applyGlobalVarAliasesToSzObject(
            { [key]: value } as unknown as SzObject,
            context.globalVarAliases,
            context.cssVariableMap,
        );
        return prefixVariantClasses(compileSzObject(aliased).className, context.variantChain);
    };

    // Exactly one of color/op may be the conditional; the other must be static.
    if (opConditional && !colorConditional && staticColor !== null) {
        return emitOpacityConditionalEntry(opConditional, staticColor, compileBranch, result);
    }
    if (colorConditional && !opConditional) {
        return emitColorConditionalEntry(colorConditional, staticOp, compileBranch, result);
    }
    return false;
}

/** A static opacity literal, or null when the object carries none. */
type StaticOpacity = string | number | null;

/** Compiles one conditional branch's color/op pair into its class string. */
type ColorOpacityBranchCompiler = (color: string, op: StaticOpacity) => string;

/** Static/conditional split of a plain `{ color, op }` object's members. */
interface ColorOpMembers {
    staticColor: string | null;
    colorConditional: ConditionalExpressionNode | null;
    staticOp: StaticOpacity;
    opConditional: ConditionalExpressionNode | null;
}

/**
 * Scans a candidate `{ color, op }` object literal into its static and
 * conditional members.
 *
 * @param object Nested object literal.
 * @returns The member split, or null when any member is not a plain
 *   color/op key with a static or conditional value.
 */
function scanColorOpMembers(object: ObjectExpressionNode): ColorOpMembers | null {
    const members: ColorOpMembers = {
        staticColor: null,
        colorConditional: null,
        staticOp: null,
        opConditional: null,
    };
    for (const property of object.properties) {
        if (property.type !== 'Property') return null;
        const member = property as PropertyNode;
        const memberKey = member.computed ? null : extractKeyName(member.key);
        // Any other member means this is not a plain color-opacity object.
        if (memberKey !== 'color' && memberKey !== 'op') return null;
        if (!scanColorOpMember(memberKey, unwrapExpression(member.value), members)) return null;
    }
    return members;
}

/**
 * Records one color/op member's static or conditional value.
 *
 * @param memberKey Member key, `color` or `op`.
 * @param value Unwrapped member value.
 * @param members Mutable member split.
 * @returns Whether the value is a supported static or conditional shape.
 */
function scanColorOpMember(memberKey: string, value: OxcNode, members: ColorOpMembers): boolean {
    if (value.type === 'ConditionalExpression') {
        if (memberKey === 'color') members.colorConditional = value as ConditionalExpressionNode;
        else members.opConditional = value as ConditionalExpressionNode;
        return true;
    }
    const literal = extractStaticLiteralValue(value);
    if (memberKey === 'color') {
        if (typeof literal !== 'string') return false;
        members.staticColor = literal;
        return true;
    }
    if (typeof literal !== 'string' && typeof literal !== 'number') return false;
    members.staticOp = literal;
    return true;
}

/**
 * Emits the conditional entry for a static color with a conditional opacity.
 *
 * @param opConditional Conditional opacity member value.
 * @param staticColor Static color value.
 * @param compileBranch Branch compiler bound to the parent key and context.
 * @param result Mutable partial result.
 * @returns Whether both branches were static and an entry was emitted.
 */
function emitOpacityConditionalEntry(
    opConditional: ConditionalExpressionNode,
    staticColor: string,
    compileBranch: ColorOpacityBranchCompiler,
    result: OxcPartialObjectResult,
): boolean {
    const consequent = extractStaticLiteralValue(opConditional.consequent);
    const alternate = extractStaticLiteralValue(opConditional.alternate);
    if (
        (typeof consequent !== 'string' && typeof consequent !== 'number') ||
        (typeof alternate !== 'string' && typeof alternate !== 'number')
    ) {
        return false;
    }
    result.conditionalClasses.push({
        test: opConditional.test,
        consequent: compileBranch(staticColor, consequent),
        alternate: compileBranch(staticColor, alternate),
    });
    return true;
}

/**
 * Emits the conditional entry for a conditional color with a static opacity.
 *
 * @param colorConditional Conditional color member value.
 * @param staticOp Static opacity value, or null when absent.
 * @param compileBranch Branch compiler bound to the parent key and context.
 * @param result Mutable partial result.
 * @returns Whether both branches were static strings and an entry was emitted.
 */
function emitColorConditionalEntry(
    colorConditional: ConditionalExpressionNode,
    staticOp: StaticOpacity,
    compileBranch: ColorOpacityBranchCompiler,
    result: OxcPartialObjectResult,
): boolean {
    const consequent = extractStaticLiteralValue(colorConditional.consequent);
    const alternate = extractStaticLiteralValue(colorConditional.alternate);
    if (typeof consequent !== 'string' || typeof alternate !== 'string') return false;
    result.conditionalClasses.push({
        test: colorConditional.test,
        consequent: compileBranch(consequent, staticOp),
        alternate: compileBranch(alternate, staticOp),
    });
    return true;
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
    if (evaluateNullablePartialConditional(key, conditional, context, result)) return true;
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
 * Compiles a conditional whose falsy/nullish branch omits the sz property.
 *
 * @param key Static property key.
 * @param conditional Conditional value.
 * @param context Shared evaluation inputs.
 * @param result Mutable partial result.
 * @returns Whether an absent branch was handled.
 */
function evaluateNullablePartialConditional(
    key: string,
    conditional: ConditionalExpressionNode,
    context: PartialObjectContext,
    result: OxcPartialObjectResult,
): boolean {
    const consequentAbsent = isAbsentSzExpression(conditional.consequent);
    const alternateAbsent = isAbsentSzExpression(conditional.alternate);
    if (!consequentAbsent && !alternateAbsent) return false;
    if (consequentAbsent && alternateAbsent) {
        result.conditionalClasses.push({
            test: conditional.test,
            consequent: '',
            alternate: '',
        });
        return true;
    }

    const presentNode = consequentAbsent ? conditional.alternate : conditional.consequent;
    const staticValue = extractStaticLiteralValue(presentNode);
    let presentClass: string;
    if (staticValue !== null) {
        presentClass = compileAliasedPartialClass(key, staticValue, context);
        presentClass = prefixVariantClasses(presentClass, context.variantChain);
    } else {
        if (!evaluateDynamicPartialProperty(key, conditional, context, result)) return false;
        const uniqueKey = context.variantChain ? `${context.variantChain}-${key}` : key;
        const info = result.dynamicProps.get(uniqueKey);
        if (!info) return false;
        info.skipClass = true;
        presentClass = buildCSSVarClassName(info);
    }
    result.conditionalClasses.push({
        test: conditional.test,
        consequent: consequentAbsent ? '' : presentClass,
        alternate: alternateAbsent ? '' : presentClass,
    });
    return true;
}

/**
 * Returns whether an expression is an omitted sz value while preserving numeric zero.
 *
 * @param expression Candidate conditional branch.
 * @returns Whether the branch emits no utility or CSS variable value.
 */
function isAbsentSzExpression(expression: OxcNode): boolean {
    const value = unwrapExpression(expression);
    if (value.type === 'Identifier') return String((value as IdentifierNode).name) === 'undefined';
    if (value.type === 'UnaryExpression') {
        return String((value as unknown as { operator: string }).operator) === 'void';
    }
    if (value.type !== 'Literal') return false;
    const literal = (value as unknown as { value: unknown }).value;
    return literal === null || literal === false || literal === '';
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
 * Applies generated style either inside a proven-safe spread or as an explicit attribute.
 *
 * @param edits MagicString instance to update.
 * @param source Original source.
 * @param styleAttr Existing style attribute, if any.
 * @param lastAttr Last JSX attribute in the opening element.
 * @param styleProps Object property source fragments.
 * @param fallbackInsertOffset Offset used when the element has no attributes.
 * @param spreadRewrite Safe spread rewrite, when available.
 */
function applyOxcGeneratedStyle(
    edits: MagicString,
    source: string,
    styleAttr: JsxAttributeNode | null,
    lastAttr: JsxAttributeNode | null,
    styleProps: string[],
    fallbackInsertOffset: number,
    spreadRewrite: OxcSafeStyleSpreadRewrite | null,
): void {
    if (spreadRewrite) {
        edits.overwrite(spreadRewrite.start, spreadRewrite.end, spreadRewrite.replacement);
        return;
    }
    applyStyleProps(edits, source, styleAttr, lastAttr, styleProps, fallbackInsertOffset);
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
            return expressionSource;
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
    // classParts ends with each conditional's [consequent, alternate] pair;
    // what precedes them is the build-time static + css-var class list.
    const staticParts = classParts.slice(0, -2 * conditionals.length).filter(Boolean);
    const bare = staticParts.length === 0;
    if (conditionals.length === 1) {
        const [entry] = conditionals;
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
    // N conditionals: template literal appending one `${…}` segment per entry
    // in property order, byte-for-byte the Babel engine's emission — first
    // quasi is `"statics "` (trailing space) or empty, single-space separators,
    // branches always "" (never `undefined`) inside the template.
    const segments = conditionals
        .map(entry => {
            const test = source.slice(entry.test.start, entry.test.end);
            return `\${${test} ? ${JSON.stringify(entry.consequent)} : ${JSON.stringify(entry.alternate)}}`;
        })
        .join(' ');
    const prefix = bare ? '' : `${staticParts.join(' ')} `;
    return `\`${prefix}${segments}\``;
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
    const literalValue = literalNodeValue(unwrapped);
    if (typeof literalValue === 'string') return literalValue;
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
            if (id?.type !== 'Identifier' || !init) {
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
            if (declarator.id?.type !== 'Identifier' || !declarator.init) {
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
        if (id?.type !== 'Identifier' || !init) {
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

/** One exported szv factory found by the registry extractor. */
export interface SzvRegistryEntry {
    /** The exported binding name. */
    exportName: string;
    /** Statically evaluated, qualification-passing config. */
    config: Record<string, unknown>;
}

/**
 * Extract every `export const X = szv(<literal config>)` from one module, for
 * the bundler's cross-module registry.
 *
 * ONE implementation on purpose: the registry is built once by the bundler and
 * fed to every engine identically, so parity holds by construction — each
 * engine then re-validates and compiles its own table through the same code
 * its local candidates use. Only configs that already pass qualification are
 * recorded, so the registry never carries junk across the boundary.
 *
 * @param source - Module source text.
 * @param filename - Module filename, for parser dialect detection.
 * @returns The exported factories, declaration order preserved.
 */
export function extractSzvRegistryEntries(source: string, filename: string): SzvRegistryEntry[] {
    if (!source.includes('szv(') || !source.includes('export')) {
        return [];
    }
    let program: { body?: OxcNode[] };
    try {
        program = parseSync(filename, source, { lang: 'tsx' }).program as unknown as {
            body?: OxcNode[];
        };
    } catch {
        /* v8 ignore next -- oxc reports syntax errors in-band; only native/parser failures throw. */
        return [];
    }
    const out: SzvRegistryEntry[] = [];
    for (const statement of program.body ?? []) {
        if (statement.type !== 'ExportNamedDeclaration') continue;
        const declaration = (statement as unknown as { declaration?: OxcNode }).declaration;
        if (declaration?.type !== 'VariableDeclaration') continue;
        for (const declarator of (declaration as unknown as VariableDeclarationNode).declarations ??
            []) {
            if (declarator.id?.type !== 'Identifier' || !declarator.init) continue;
            const exportName = declarator.id.name;
            if (exportName === undefined || SZV_RESERVED_FACTORY_NAMES.has(exportName)) {
                continue;
            }
            const init = unwrapExpression(declarator.init);
            if (init.type !== 'CallExpression') continue;
            const call = init as CallExpressionNode;
            if (call.callee.type !== 'Identifier') continue;
            if ((call.callee as IdentifierNode).name !== 'szv') continue;
            if (call.arguments.length !== 1) continue;
            const argument = unwrapExpression(call.arguments[0] as OxcNode);
            if (argument.type !== 'ObjectExpression') continue;
            const config = evaluateStaticObjectOxc(argument);
            if (config === null || qualifyStaticSzvConfig(config) === null) continue;
            out.push({ exportName, config });
        }
    }
    return out;
}
