import * as babel from '@babel/core';
import * as t from '@babel/types';

import { AST_BUDGET, ASTBudgetExceededError } from './ast-budget.js';
import type { TokenData } from './manifest.js';
import {
    COLOR_PROPERTIES,
    getCSSVariableName,
    getPropertyCategory,
    PropertyCategory,
} from './property-types.js';
import { generateInlineRecoveryToken, isValidInlineRecoveryMode } from './recovery-tokens.js';
import {
    deepMergeSzObjects,
    formatSzWarnLocation,
    getVariantPrefix,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    type SzObject,
    type SzValue,
    setSzWarnLocation,
    transform,
} from './transform-core.js';

// Re-export everything from core so consumers don't break
export { AST_BUDGET, ASTBudgetExceededError } from './ast-budget.js';
export * from './transform-core.js';

/**
 * Return JSX attributes without one previously captured attribute node.
 *
 * @param attributes Opening-element attributes.
 * @param target Attribute node to remove.
 * @returns Attributes excluding the target node.
 */
function withoutJSXAttribute(
    attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
    target: t.JSXAttribute,
): Array<t.JSXAttribute | t.JSXSpreadAttribute> {
    return attributes.filter(attribute => attribute !== target);
}

/**
 * Collects literal class tokens from an existing class attribute.
 *
 * @param attribute Class or className attribute.
 * @param rawClassNames Shared Tailwind discovery set.
 */
function collectRawClassNameAttribute(attribute: t.JSXAttribute, rawClassNames: Set<string>): void {
    if (!t.isStringLiteral(attribute.value)) return;
    for (const className of attribute.value.value.split(/\s+/)) {
        if (className) rawClassNames.add(className);
    }
}

/**
 * Validates an inline recovery mode and attaches its deterministic token.
 *
 * @param path Recovery attribute path.
 * @param filename Source filename for recovery metadata.
 * @param diagnostics Shared compiler diagnostics.
 * @param recoveryTokens Shared recovery-token catalog.
 * @returns Whether a token attribute was attached.
 */
function transformRecoveryAttribute(
    path: babel.NodePath<t.JSXAttribute>,
    filename: string | undefined,
    diagnostics: string[],
    recoveryTokens: Map<string, TokenData>,
): boolean {
    const recoverValue = path.node.value;
    if (!t.isStringLiteral(recoverValue)) {
        diagnostics.push(
            `[csszyx] szRecover at ${filename ?? '<anonymous>'}: ` +
                'only string-literal values ("csr" | "dev-only") are supported. ' +
                'Dynamic values disable token emission for this element.',
        );
        return false;
    }
    if (!isValidInlineRecoveryMode(recoverValue.value)) {
        diagnostics.push(
            `[csszyx] szRecover at ${filename ?? '<anonymous>'}: ` +
                `unknown mode "${recoverValue.value}" — expected "csr" or "dev-only". ` +
                'Token emission skipped.',
        );
        return false;
    }
    const opening = path.parentPath;
    if (!opening?.isJSXOpeningElement() || hasRecoveryToken(opening.node.attributes)) return false;

    const elementType = recoveryElementType(opening.node.name);
    const line = path.node.loc?.start.line ?? 0;
    const column = path.node.loc?.start.column ?? 0;
    const file = filename ?? 'file.tsx';
    const token = generateInlineRecoveryToken(file, line, column, elementType);
    opening.node.attributes.push(
        t.jsxAttribute(t.jsxIdentifier('data-sz-recovery-token'), t.stringLiteral(token)),
    );
    recoveryTokens.set(token, {
        mode: recoverValue.value,
        component: elementType,
        path: `${file}:${line}:${column}`,
    });
    return true;
}

/**
 * Returns whether an opening element already carries a recovery token.
 *
 * @param attributes Opening-element attributes.
 * @returns Whether a recovery token is present.
 */
function hasRecoveryToken(attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>): boolean {
    return attributes.some(
        attribute =>
            t.isJSXAttribute(attribute) &&
            t.isJSXIdentifier(attribute.name) &&
            attribute.name.name === 'data-sz-recovery-token',
    );
}

/**
 * Formats a stable component label for recovery metadata.
 *
 * @param name JSX opening-element name.
 * @returns Stable recovery component label.
 */
function recoveryElementType(name: t.JSXOpeningElement['name']): string {
    if (t.isJSXIdentifier(name)) return name.name;
    return t.isJSXMemberExpression(name) ? '<member>' : '<unknown>';
}

/** One validated and compiled szs slot. */
interface CompiledSzsSlot {
    slot: t.ObjectProperty;
    classes: string;
    rewrite: boolean;
}

/**
 * Compiles a static szs slot map and renames it to the read-side prop.
 *
 * @param path szs attribute path.
 * @param filename Source filename for diagnostics.
 * @param rootDir Project root for relative diagnostics.
 * @param diagnostics Shared compiler diagnostics.
 * @param pendingClasses Ordered szs class collection.
 * @returns Whether the attribute was compiled.
 */
function transformSzsAttribute(
    path: babel.NodePath<t.JSXAttribute>,
    filename: string | undefined,
    rootDir: string | undefined,
    diagnostics: string[],
    pendingClasses: string[],
): boolean {
    const opening = path.parentPath?.isJSXOpeningElement() ? path.parentPath.node : null;
    if (opening && isHostElementName(opening.name)) {
        diagnostics.push(
            `[csszyx] szs at ${filename ?? '<anonymous>'}: ` +
                'szs has no effect on a host element — it maps slot names of a ' +
                'custom component. Attribute left unchanged.',
        );
        return false;
    }
    const container = path.node.value;
    if (!t.isJSXExpressionContainer(container) || !t.isObjectExpression(container.expression)) {
        diagnostics.push(szsUnsupportedMessage(filename));
        return false;
    }
    const slotMap = container.expression;
    if (!isValidSzsSlotMap(slotMap)) {
        diagnostics.push(szsUnsupportedMessage(filename));
        return false;
    }
    setSzWarnLocation(
        formatSzWarnLocation(filename ?? 'file.tsx', path.node.loc?.start.line, rootDir),
    );
    const compiledSlots = compileSzsSlots(slotMap);
    if (!compiledSlots) {
        diagnostics.push(szsUnsupportedMessage(filename));
        return false;
    }
    applyCompiledSzsSlots(compiledSlots, pendingClasses);
    path.node.name = t.jsxIdentifier('szsc');
    return true;
}

/**
 * Compiles every validated szs slot without mutating the source map.
 *
 * @param slotMap Validated static slot map.
 * @returns Compiled slots, or null when a value is unsupported.
 */
function compileSzsSlots(slotMap: t.ObjectExpression): CompiledSzsSlot[] | null {
    const compiledSlots: CompiledSzsSlot[] = [];
    for (const property of slotMap.properties) {
        const slot = property as t.ObjectProperty;
        if (t.isStringLiteral(slot.value)) {
            compiledSlots.push({ slot, classes: slot.value.value, rewrite: false });
            continue;
        }
        const compiled = tryStaticTransformNode(slot.value as t.Node);
        if (!compiled || !t.isStringLiteral(compiled)) return null;
        compiledSlots.push({ slot, classes: compiled.value, rewrite: true });
    }
    return compiledSlots;
}

/**
 * Applies compiled szs values and records their class tokens in slot order.
 *
 * @param compiledSlots Fully compiled slots.
 * @param pendingClasses Ordered szs class collection.
 */
function applyCompiledSzsSlots(compiledSlots: CompiledSzsSlot[], pendingClasses: string[]): void {
    for (const { slot, classes, rewrite } of compiledSlots) {
        if (rewrite) slot.value = t.stringLiteral(classes);
        for (const className of classes.split(/\s+/)) {
            if (className) pendingClasses.push(className);
        }
    }
}

/** Existing class and style attributes resolved from one opening element. */
interface ExistingJsxAttributes {
    classNameNode: t.JSXAttribute | null;
    classExpression: t.Expression | null;
    styleNode: t.JSXAttribute | null;
    styleExpression: t.Expression | null;
}

/** Runtime helpers required by class-name merging. */
interface ClassMergeUsage {
    runtime: boolean;
    merge: boolean;
}

/**
 * Finds existing class and style values that an sz transform must preserve.
 *
 * @param path sz attribute path.
 * @returns Existing mergeable attribute nodes and expressions.
 */
function findExistingJsxAttributes(path: babel.NodePath<t.JSXAttribute>): ExistingJsxAttributes {
    const existing: ExistingJsxAttributes = {
        classNameNode: null,
        classExpression: null,
        styleNode: null,
        styleExpression: null,
    };
    if (!path.parentPath?.isJSXOpeningElement()) return existing;
    for (const attribute of path.parentPath.node.attributes) {
        if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name)) continue;
        if (attribute.name.name === 'className' || attribute.name.name === 'class') {
            existing.classNameNode = attribute;
            existing.classExpression = jsxAttributeExpression(attribute.value);
        } else if (attribute.name.name === 'style') {
            existing.styleNode = attribute;
            existing.styleExpression = jsxAttributeExpression(attribute.value);
        }
    }
    return existing;
}

/**
 * Merges a compiled sz class value with an existing JSX class attribute.
 *
 * @param path sz attribute path.
 * @param szExpression Compiled sz class expression.
 * @param existing Existing JSX attributes for the opening element.
 * @param usage Runtime helper usage accumulated by the transform.
 * @returns JSX-compatible merged class value.
 */
function mergeClassNameValue(
    path: babel.NodePath<t.JSXAttribute>,
    szExpression: t.Expression,
    existing: ExistingJsxAttributes,
    usage: ClassMergeUsage,
): t.StringLiteral | t.JSXExpressionContainer {
    if (!existing.classExpression) {
        if (t.isStringLiteral(szExpression) && szExpression.value === '') {
            return t.jsxExpressionContainer(t.identifier('undefined'));
        }
        return t.isStringLiteral(szExpression)
            ? szExpression
            : t.jsxExpressionContainer(szExpression);
    }

    if (existing.classNameNode && path.parentPath?.isJSXOpeningElement()) {
        path.parentPath.node.attributes = withoutJSXAttribute(
            path.parentPath.node.attributes,
            existing.classNameNode,
        );
        existing.classNameNode = null;
    }

    if (t.isStringLiteral(existing.classExpression) && t.isStringLiteral(szExpression)) {
        return t.stringLiteral(`${existing.classExpression.value} ${szExpression.value}`.trim());
    }

    usage.runtime = true;
    usage.merge = true;
    return t.jsxExpressionContainer(
        t.callExpression(t.identifier('_szMerge'), [existing.classExpression, szExpression]),
    );
}

/**
 * Adds generated CSS custom properties to an opening element style attribute.
 *
 * @param path sz attribute path.
 * @param newStyleProperties Generated style properties.
 * @param existing Existing JSX attributes for the opening element.
 */
function mergeStyleProperties(
    path: babel.NodePath<t.JSXAttribute>,
    newStyleProperties: t.ObjectProperty[],
    existing: ExistingJsxAttributes,
): void {
    if (newStyleProperties.length === 0 || !path.parentPath?.isJSXOpeningElement()) return;

    if (!existing.styleNode || !existing.styleExpression) {
        const styleExpression = t.objectExpression(newStyleProperties);
        const styleAttribute = t.jsxAttribute(
            t.jsxIdentifier('style'),
            t.jsxExpressionContainer(styleExpression),
        );
        path.parentPath.node.attributes.push(styleAttribute);
        existing.styleExpression = styleExpression;
        existing.styleNode = styleAttribute;
        return;
    }

    path.parentPath.node.attributes = withoutJSXAttribute(
        path.parentPath.node.attributes,
        existing.styleNode,
    );
    existing.styleNode = null;

    let mergedStyle: t.ObjectExpression;
    if (t.isObjectExpression(existing.styleExpression)) {
        existing.styleExpression.properties.push(...newStyleProperties);
        mergedStyle = existing.styleExpression;
    } else if (t.isStringLiteral(existing.styleExpression)) {
        const parsedProperties = parseStyleStringToObjectExpr(
            existing.styleExpression.value,
        ).properties;
        mergedStyle = t.objectExpression([...parsedProperties, ...newStyleProperties]);
    } else {
        mergedStyle = t.objectExpression([
            t.spreadElement(existing.styleExpression),
            ...newStyleProperties,
        ]);
    }
    path.parentPath.node.attributes.push(
        t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(mergedStyle)),
    );
}

/** One classified sz array element. */
type SzArrayPart =
    | { kind: 'obj'; sz: SzObject }
    | { kind: 'str'; value: string }
    | { kind: 'cond'; cond: t.Expression; classNames: string }
    | { kind: 'dyn'; node: t.Expression };

/** Result of compiling an sz array expression. */
interface SzArrayTransformResult {
    transformed: boolean;
    usesSzcn: boolean;
    usesSzPart: boolean;
}

/** Result of compiling an sz object expression. */
interface SzObjectTransformResult {
    transformed: boolean;
    usesColorVar: boolean;
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
}

/** Generated class and style expressions for a partially static sz object. */
interface PartialObjectArtifacts {
    classExpression: t.Expression;
    styleProperties: t.ObjectProperty[];
}

/**
 * Writes one compiled class expression and records its Tailwind candidates.
 *
 * @param path sz attribute path.
 * @param expression Compiled class expression.
 * @param existing Existing JSX attributes.
 * @param classMergeUsage Runtime class merge usage.
 * @param classes Tailwind discovery set.
 */
function applyCompiledClassExpression(
    path: babel.NodePath<t.JSXAttribute>,
    expression: t.Expression,
    existing: ExistingJsxAttributes,
    classMergeUsage: ClassMergeUsage,
    classes: Set<string>,
): void {
    path.node.name.name = 'className';
    path.node.value = mergeClassNameValue(path, expression, existing, classMergeUsage);
    if (t.isStringLiteral(expression)) collectClassTokens(expression.value, classes);
    else collectFromExpr(expression, classes);
}

/**
 * Builds class and inline-style expressions for a partially static object.
 *
 * @param partial Partial object evaluation.
 * @param classes Tailwind discovery set.
 * @returns Generated class and style expressions.
 */
function buildPartialObjectArtifacts(
    partial: PartialObjectResult,
    classes: Set<string>,
): PartialObjectArtifacts {
    const staticClasses: string[] = [];
    if (Object.keys(partial.staticProps).length > 0) {
        const compiled = transform(partial.staticProps).className;
        if (compiled) staticClasses.push(compiled);
    }

    const cssVarClasses: string[] = [];
    const styleProperties: t.ObjectProperty[] = [];
    for (const [, info] of partial.dynamicProps) {
        if (!info.skipClass) cssVarClasses.push(buildCSSVarClassName(info));
        styleProperties.push(
            t.objectProperty(t.stringLiteral(info.varName), generateStyleValueExpression(info)),
        );
    }

    const baseClasses = [...staticClasses, ...partial.rawClasses, ...cssVarClasses].join(' ');
    collectClassTokens(baseClasses, classes);
    for (const conditional of partial.conditionalClasses) {
        collectClassTokens(conditional.consequent, classes);
        collectClassTokens(conditional.alternate, classes);
    }
    const classExpression =
        partial.conditionalClasses.length > 0
            ? buildConditionalClassExpr(baseClasses, partial.conditionalClasses)
            : t.stringLiteral(baseClasses);
    return { classExpression, styleProperties };
}

/**
 * Compiles one object-literal sz expression when enough of it is static.
 *
 * @param path sz attribute path.
 * @param expression Object expression to compile.
 * @param existing Existing JSX attributes.
 * @param classMergeUsage Runtime class merge usage.
 * @param classes Tailwind discovery set.
 * @returns Object transform result and style-helper usage.
 */
function transformSzObjectExpression(
    path: babel.NodePath<t.JSXAttribute>,
    expression: t.ObjectExpression,
    existing: ExistingJsxAttributes,
    classMergeUsage: ClassMergeUsage,
    classes: Set<string>,
): SzObjectTransformResult {
    const unchanged: SzObjectTransformResult = {
        transformed: false,
        usesColorVar: false,
        usesSpacingVar: false,
        usesUnitVar: false,
    };
    const getBinding: GetBinding = name => path.scope.getBinding(name);
    const flatExpression = resolveObjectSpreads(expression, getBinding) ?? expression;

    const staticObject = evaluateStaticObject(flatExpression);
    if (staticObject !== null) {
        applyCompiledClassExpression(
            path,
            t.stringLiteral(transform(staticObject).className),
            existing,
            classMergeUsage,
            classes,
        );
        return { ...unchanged, transformed: true };
    }

    const hoisted = tryHoistConditionalSpread(expression, getBinding);
    if (hoisted !== null) {
        applyCompiledClassExpression(path, hoisted, existing, classMergeUsage, classes);
        return { ...unchanged, transformed: true };
    }

    const nestedConditional = tryHoistNestedConditional(flatExpression, getBinding);
    if (nestedConditional !== null) {
        applyCompiledClassExpression(path, nestedConditional, existing, classMergeUsage, classes);
        return { ...unchanged, transformed: true };
    }

    const partial = evaluatePartialObject(flatExpression);
    if (
        partial === null ||
        partial.hasSpread ||
        (partial.dynamicProps.size === 0 && partial.conditionalClasses.length === 0)
    ) {
        return unchanged;
    }

    const artifacts = buildPartialObjectArtifacts(partial, classes);
    applyCompiledClassExpression(
        path,
        artifacts.classExpression,
        existing,
        classMergeUsage,
        classes,
    );
    mergeStyleProperties(path, artifacts.styleProperties, existing);
    return {
        transformed: true,
        usesColorVar: partial.usesColorVar,
        usesSpacingVar: partial.usesSpacingVar,
        usesUnitVar: partial.usesUnitVar,
    };
}

/**
 * Resolves identifier and conditional sz expressions at build time.
 *
 * @param path sz attribute path.
 * @param expression Expression to resolve.
 * @returns Compiled class expression, or null when unresolved.
 */
function resolveStaticSzExpression(
    path: babel.NodePath<t.JSXAttribute>,
    expression: t.Expression | t.JSXEmptyExpression,
): t.Expression | null {
    const getBinding: GetBinding = name => path.scope.getBinding(name);
    if (t.isConditionalExpression(expression)) {
        return tryStaticTransformNode(expression, getBinding);
    }
    if (!t.isIdentifier(expression)) return null;
    const binding = path.scope.getBinding(expression.name);
    if (!binding?.path.isVariableDeclarator() || !binding.path.node.init) return null;
    return tryStaticTransformNode(binding.path.node.init, getBinding);
}

/** Runtime fallback reason and its actionable replacement guidance. */
interface RuntimeFallbackDescription {
    reason: string;
    suggestion: string;
}

/**
 * Describes why one sz expression requires runtime evaluation.
 *
 * @param expression Unresolved sz expression.
 * @returns Runtime fallback reason and suggestion.
 */
function describeRuntimeFallback(expression: t.Expression): RuntimeFallbackDescription {
    if (t.isCallExpression(expression)) {
        const callee = expression.callee;
        const name = t.isIdentifier(callee)
            ? callee.name
            : t.isMemberExpression(callee) && t.isIdentifier(callee.property)
              ? callee.property.name
              : '?';
        return {
            reason: `function call \`${name}()\` result is unknown at build time`,
            suggestion:
                'If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic().',
        };
    }
    if (t.isIdentifier(expression)) {
        return {
            reason: `identifier \`${expression.name}\` could not be resolved to a static value`,
            suggestion:
                "Make sure it's a module-level or function-body const with a literal object value. For variant-based styling → szv(). For true runtime values → dynamic().",
        };
    }
    if (t.isMemberExpression(expression)) {
        return {
            reason: 'member expression is not statically resolvable',
            suggestion:
                'Extract the value to a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().',
        };
    }
    return {
        reason: `expression of type \`${expression.type}\` is not statically analyzable`,
        suggestion:
            'Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().',
    };
}

/**
 * Whether an object expression contains a top-level spread.
 *
 * @param expression Object expression to inspect.
 * @returns Whether a top-level spread is present.
 */
function hasTopLevelSpread(expression: t.ObjectExpression): boolean {
    for (const property of expression.properties) {
        if (t.isSpreadElement(property)) return true;
    }
    return false;
}

/**
 * Emits diagnostics and wraps one unresolved sz expression with the runtime helper.
 *
 * @param path sz attribute path.
 * @param expression Unresolved sz expression.
 * @param existing Existing JSX attributes.
 * @param classMergeUsage Runtime class merge usage.
 * @param classes Tailwind discovery set.
 * @param diagnostics Compiler diagnostics.
 */
function transformRuntimeSzFallback(
    path: babel.NodePath<t.JSXAttribute>,
    expression: t.Expression,
    existing: ExistingJsxAttributes,
    classMergeUsage: ClassMergeUsage,
    classes: Set<string>,
    diagnostics: string[],
): void {
    const lineColumn = expression.loc
        ? `${expression.loc.start.line}:${expression.loc.start.column + 1}`
        : '?';
    const description = describeRuntimeFallback(expression);
    diagnostics.push(
        `sz fallback at ${lineColumn}: ${description.reason}.\n  Suggestion: ${description.suggestion}`,
    );
    if (t.isObjectExpression(expression) && hasTopLevelSpread(expression)) {
        diagnostics.push(
            `[csszyx] unresolvable sz spread at ${lineColumn}: ` +
                'sz={{ ...x }} cannot be resolved at build time and falls back to runtime; ' +
                'it may render no styles in production. Use array form: sz={[x, { ... }]}.',
        );
    }

    path.node.name.name = 'className';
    collectCandidatesFromBabelExpr(expression, path, classes);
    path.node.value = mergeClassNameValue(
        path,
        t.callExpression(t.identifier('_sz'), [expression]),
        existing,
        classMergeUsage,
    );
    classMergeUsage.runtime = true;
}

/** Runtime helpers used while transforming one sz attribute value. */
interface SzValueTransformResult {
    transformed: boolean;
    usesColorVar: boolean;
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
    usesSzcn: boolean;
    usesSzPart: boolean;
}

/**
 * Empty helper usage for an unsupported JSX attribute value.
 *
 * @returns A result with every transform and helper flag disabled.
 */
function unchangedSzValueResult(): SzValueTransformResult {
    return {
        transformed: false,
        usesColorVar: false,
        usesSpacingVar: false,
        usesUnitVar: false,
        usesSzcn: false,
        usesSzPart: false,
    };
}

/**
 * Transforms one sz attribute value and reports its runtime helper usage.
 *
 * @param path sz attribute path.
 * @param existing Existing JSX attributes.
 * @param classMergeUsage Runtime class merge usage.
 * @param classes Tailwind discovery set.
 * @param diagnostics Compiler diagnostics.
 * @returns Transform status and runtime helper usage.
 */
function transformSzAttributeValue(
    path: babel.NodePath<t.JSXAttribute>,
    existing: ExistingJsxAttributes,
    classMergeUsage: ClassMergeUsage,
    classes: Set<string>,
    diagnostics: string[],
): SzValueTransformResult {
    const value = path.node.value;
    if (t.isStringLiteral(value)) {
        applyCompiledClassExpression(path, value, existing, classMergeUsage, classes);
        return { ...unchangedSzValueResult(), transformed: true };
    }
    if (!t.isJSXExpressionContainer(value)) return unchangedSzValueResult();

    const expression = value.expression;
    if (t.isObjectExpression(expression)) {
        const objectResult = transformSzObjectExpression(
            path,
            expression,
            existing,
            classMergeUsage,
            classes,
        );
        if (objectResult.transformed) {
            return { ...objectResult, usesSzcn: false, usesSzPart: false };
        }
    }

    const staticExpression = resolveStaticSzExpression(path, expression);
    if (staticExpression !== null) {
        applyCompiledClassExpression(path, staticExpression, existing, classMergeUsage, classes);
        return { ...unchangedSzValueResult(), transformed: true };
    }

    if (t.isArrayExpression(expression)) {
        const arrayResult = transformSzArrayExpression(
            path,
            expression,
            existing,
            classMergeUsage,
            classes,
            diagnostics,
        );
        if (arrayResult.transformed) {
            return {
                ...unchangedSzValueResult(),
                ...arrayResult,
            };
        }
    }

    transformRuntimeSzFallback(
        path,
        expression as t.Expression,
        existing,
        classMergeUsage,
        classes,
        diagnostics,
    );
    return { ...unchangedSzValueResult(), transformed: true };
}

/**
 * Classifies a conditional sz array element.
 *
 * @param expression Conditional expression to classify.
 * @param getBinding Babel binding resolver.
 * @returns Compiled conditional or dynamic array part.
 */
function classifyConditionalArrayPart(
    expression: t.LogicalExpression,
    getBinding: GetBinding,
): SzArrayPart {
    const right = unwrapTsExpression(expression.right) ?? expression.right;
    let classNames = t.isStringLiteral(right) ? right.value : null;
    if (classNames === null) {
        const resolved = tryResolveStaticSzObject(right, getBinding);
        if (resolved !== null) classNames = transform(resolved).className;
    }
    if (classNames !== null) {
        return { kind: 'cond', cond: expression.left, classNames };
    }
    return { kind: 'dyn', node: expression };
}

/**
 * Classifies one non-spread sz array element, omitting inert values.
 *
 * @param element Array element to classify.
 * @param getBinding Babel binding resolver.
 * @returns Classified part, or null for an inert value.
 */
function classifySzArrayElement(
    element: t.Expression | t.JSXNamespacedName | t.ArgumentPlaceholder | null,
    getBinding: GetBinding,
): SzArrayPart | null {
    if (element === null) return null;
    const inner = unwrapTsExpression(element) ?? element;
    if (t.isBooleanLiteral(inner) && !inner.value) return null;
    if (t.isNullLiteral(inner)) return null;
    if (t.isIdentifier(inner) && inner.name === 'undefined') return null;
    if (t.isStringLiteral(inner)) return { kind: 'str', value: inner.value };
    if (t.isLogicalExpression(inner) && inner.operator === '&&') {
        const part = classifyConditionalArrayPart(inner, getBinding);
        return part.kind === 'cond' && part.classNames === '' ? null : part;
    }
    const resolved = tryResolveStaticSzObject(inner, getBinding);
    if (resolved !== null) return { kind: 'obj', sz: resolved };
    return { kind: 'dyn', node: element as t.Expression };
}

/**
 * Returns classified array parts, or null when a spread requires runtime fallback.
 *
 * @param expression Array expression to classify.
 * @param getBinding Babel binding resolver.
 * @returns Classified parts, or null when a spread is present.
 */
function classifySzArrayParts(
    expression: t.ArrayExpression,
    getBinding: GetBinding,
): SzArrayPart[] | null {
    const parts: SzArrayPart[] = [];
    for (const element of expression.elements) {
        if (t.isSpreadElement(element)) return null;
        const part = classifySzArrayElement(element, getBinding);
        if (part) parts.push(part);
    }
    return parts;
}

/**
 * Adds class tokens from a compiled string to Tailwind discovery.
 *
 * @param value Compiled class string.
 * @param classes Tailwind discovery set.
 */
function collectClassTokens(value: string, classes: Set<string>): void {
    for (const className of value.split(/\s+/)) {
        if (className) classes.add(className);
    }
}

/**
 * Appends one classified sz array part to the runtime composition arguments.
 *
 * @param part Classified array part.
 * @param args Runtime composition arguments.
 * @param getBinding Babel binding resolver.
 * @param classes Tailwind discovery set.
 * @param diagnostics Compiler diagnostics.
 * @returns Whether the part requires the runtime sz-part helper.
 */
function appendSzArrayArgument(
    part: SzArrayPart,
    args: t.Expression[],
    getBinding: GetBinding,
    classes: Set<string>,
    diagnostics: string[],
): boolean {
    if (part.kind === 'obj') {
        const compiled = transform(part.sz).className;
        collectClassTokens(compiled, classes);
        args.push(t.stringLiteral(compiled));
        return false;
    }
    if (part.kind === 'str') {
        collectClassTokens(part.value, classes);
        args.push(t.stringLiteral(part.value));
        return false;
    }
    if (part.kind === 'cond') {
        collectClassTokens(part.classNames, classes);
        args.push(t.logicalExpression('&&', part.cond, t.stringLiteral(part.classNames)));
        return false;
    }

    collectDynamicElementCandidates(part.node, getBinding, classes);
    const unwrapped = unwrapTsExpression(part.node);
    if (unwrapped && t.isObjectExpression(unwrapped)) {
        diagnostics.push(buildSzPartElementDiagnostic(part.node));
    }
    args.push(t.callExpression(t.identifier('_szPart'), [part.node]));
    return true;
}

/**
 * Compiles an sz array expression when it has no spread element.
 *
 * @param path sz attribute path.
 * @param expression Array expression to compile.
 * @param existing Existing JSX attributes for the opening element.
 * @param classMergeUsage Runtime class merge usage.
 * @param classes Tailwind discovery set.
 * @param diagnostics Compiler diagnostics.
 * @returns Array transform result and runtime helper usage.
 */
function transformSzArrayExpression(
    path: babel.NodePath<t.JSXAttribute>,
    expression: t.ArrayExpression,
    existing: ExistingJsxAttributes,
    classMergeUsage: ClassMergeUsage,
    classes: Set<string>,
    diagnostics: string[],
): SzArrayTransformResult {
    const getBinding: GetBinding = name => path.scope.getBinding(name);
    const parts = classifySzArrayParts(expression, getBinding);
    if (!parts) return { transformed: false, usesSzcn: false, usesSzPart: false };

    if (parts.every(part => part.kind === 'obj')) {
        const merged = (parts as Array<{ kind: 'obj'; sz: SzObject }>).reduce<SzObject>(
            (accumulator, part) => deepMergeSzObjects(accumulator, part.sz),
            {},
        );
        const compiled = transform(merged).className;
        collectClassTokens(compiled, classes);
        path.node.name.name = 'className';
        path.node.value = mergeClassNameValue(
            path,
            t.stringLiteral(compiled),
            existing,
            classMergeUsage,
        );
        return { transformed: true, usesSzcn: false, usesSzPart: false };
    }

    const args: t.Expression[] = [];
    let usesSzPart = false;
    for (const part of parts) {
        const partUsesSzPart = appendSzArrayArgument(part, args, getBinding, classes, diagnostics);
        usesSzPart ||= partUsesSzPart;
    }
    if (existing.classExpression) {
        args.unshift(existing.classExpression);
        if (existing.classNameNode && path.parentPath?.isJSXOpeningElement()) {
            path.parentPath.node.attributes = withoutJSXAttribute(
                path.parentPath.node.attributes,
                existing.classNameNode,
            );
            existing.classNameNode = null;
        }
    }
    path.node.name.name = 'className';
    path.node.value = t.jsxExpressionContainer(t.callExpression(t.identifier('_szcn'), args));
    return { transformed: true, usesSzcn: true, usesSzPart };
}

/**
 * Resolves a literal or expression-container attribute value to an expression.
 *
 * @param value JSX attribute value.
 * @returns Mergeable expression, or null for unsupported value shapes.
 */
function jsxAttributeExpression(
    value: t.JSXAttribute['value'],
): t.Expression | t.StringLiteral | null {
    if (t.isStringLiteral(value)) return value;
    if (t.isJSXExpressionContainer(value) && t.isExpression(value.expression)) {
        return value.expression;
    }
    return null;
}

/**
 * Options for {@link transformSourceCode}.
 */
export interface TransformSourceCodeOptions {
    /**
     * Override the AST node budget. Files larger than this throw
     * {@link ASTBudgetExceededError}. Defaults to {@link AST_BUDGET} (50 000).
     * Useful for repos with legitimately large generated files (json-as-ts
     * fixtures, GraphQL schema snapshots) that exceed the default cap but
     * are still safe to transform.
     */
    astBudget?: number;

    /**
     * Opt into tiered CSS custom property names for parser paths that support
     * the CSS variable system. Unsupported parser paths must preserve existing
     * `--_sz-*` output until they explicitly port this option.
     *
     * @default false
     */
    mangleVars?: boolean;

    /**
     * Maximum cascade depth for component-tier CSS variable hoisting.
     *
     * Only used when `mangleVars` is enabled. Defaults to 5 to keep the
     * invalidation surface bounded.
     */
    mangleVarHoistMaxDepth?: number;

    /**
     * Explicit app-owned global CSS custom-property aliases. Parser paths that
     * support Phase H rewrite exact static sz string values from original
     * token names to aliases, for example `--brand-primary` -> `---gz`.
     */
    globalVarAliases?: GlobalVarAliasTableInput;

    /**
     * Project root used only to render diagnostic file paths relative to it (so a
     * dev-mode "Unknown property" warning reads `src/Foo.tsx:12`, not an absolute
     * path). When omitted, diagnostics fall back to the filename as given.
     */
    rootDir?: string;
}

/**
 * Accepted input shapes for global CSS custom-property alias tables.
 */
export type GlobalVarAliasTableInput =
    | ReadonlyMap<string, string>
    | ReadonlyArray<readonly [string, string]>
    | Readonly<Record<string, string>>;

/**
 * CSS custom-property mangle metadata. Most originals map to one mangled name,
 * but the same original can legitimately appear in both scoped and hoisted
 * tiers in one build, e.g. `--_sz-p` -> `--sz` and `--cz`.
 */
export type CssVariableMangleValue = string | string[];

/**
 * Source transform result shared by the Babel and oxc parser paths.
 */
export interface SourceTransformResult {
    /** Rewritten source code. */
    code: string;
    /** Whether csszyx changed the source. */
    transformed: boolean;
    /** Whether the source needs the _sz runtime helper. */
    usesRuntime: boolean;
    /** Whether the source needs the _szMerge runtime helper. */
    usesMerge: boolean;
    /** Whether the source needs the szcn runtime helper (sz array composition). */
    usesSzcn: boolean;
    /** Whether the source needs the _szPart runtime helper (dynamic array elements). */
    usesSzPart: boolean;
    /** Whether the source needs the color-var runtime helper. */
    usesColorVar: boolean;
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
    /** Classes generated from sz syntax. */
    classes: Set<string>;
    /** Raw className/class strings collected for Tailwind discovery only. */
    rawClassNames: Set<string>;
    /** Compiler diagnostics to emit in development. */
    diagnostics: string[];
    /** Recovery tokens emitted by szRecover attributes. */
    recoveryTokens: Map<string, TokenData>;
    /** CSS custom property original-to-mangled names emitted by mangleVars. */
    cssVariableMap: Map<string, CssVariableMangleValue>;
}

/**
 * Transforms all sz props in a source code string into Tailwind classNames.
 *
 * @param {string} source - The source code to transform
 * @param {string} [filename] - Source filename, used in error messages and
 *   passed to Babel as the parser filename. Defaults to a placeholder.
 * @param {TransformSourceCodeOptions} [options] - Optional overrides
 *   (currently: `astBudget` to raise/lower the per-file node cap).
 * @returns {object} Transformation result with code and metadata
 * @throws {ASTBudgetExceededError} when the file's AST exceeds the
 *   effective budget (`options.astBudget` or {@link AST_BUDGET}).
 */
export function transformSourceCode(
    source: string,
    filename?: string,
    options?: TransformSourceCodeOptions,
): SourceTransformResult {
    const astBudget = options?.astBudget ?? AST_BUDGET;
    const classMergeUsage: ClassMergeUsage = { runtime: false, merge: false };
    let usesSzcn = false;
    let usesSzPart = false;
    let usesColorVar = false;
    let usesSpacingVar = false;
    let usesUnitVar = false;
    let transformed = false;
    const collectedClasses = new Set<string>();
    // Classes discovered from `szs` slot values. Kept OUT of collectedClasses
    // until after the traversal so the discovery order is deterministic across
    // engines: all sz-derived classes (document order) first, then all
    // szs-derived classes (document order). Mangle IDs are assigned in discovery
    // order, so this ordering is part of the three-engine parity contract.
    const szsPendingClasses: string[] = [];
    // Raw class names from className="..." attributes — used for TW JIT safelist only, NOT for mangling.
    const rawClassNames = new Set<string>();
    // Dev-mode diagnostics: emitted when sz props fall back to runtime transforms.
    const diagnostics: string[] = [];
    // Recovery tokens collected from szRecover attributes in this file. Keyed
    // by token (12-char hex hash); the unplugin aggregates these across all
    // files and serializes the result into the manifest script tag.
    const recoveryTokens = new Map<string, TokenData>();
    const cssVariableMap = new Map<string, CssVariableMangleValue>();

    // Fast path: check if file contains 'sz' before parsing
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
            classes: collectedClasses,
            rawClassNames,
            diagnostics,
            recoveryTokens,
            cssVariableMap,
        };
    }

    try {
        const result = babel.transformSync(source, {
            filename: filename ?? 'file.tsx', // Enable TS/JSX parsing
            ast: true,
            code: true,
            configFile: false,
            babelrc: false,
            parserOpts: {
                plugins: ['typescript', 'jsx'],
            },
            plugins: [
                () => ({
                    // Budget guard runs in `pre` (before the visitor pass)
                    // so it short-circuits pathologically large files
                    // before any sz transform work begins, and doesn't
                    // interfere with the JSXAttribute handler below.
                    pre(file: { ast: t.File }) {
                        // Clear any unknown-property warn location a previous
                        // transform left set after an early return.
                        setSzWarnLocation(undefined);
                        let nodeCount = 0;
                        babel.traverse(file.ast, {
                            enter() {
                                nodeCount++;
                                if (nodeCount > astBudget) {
                                    throw new ASTBudgetExceededError(
                                        filename,
                                        nodeCount,
                                        astBudget,
                                    );
                                }
                            },
                        });
                    },
                    // Drop the warn location after the file's visitor pass so it
                    // never leaks to an unrelated later transform or the runtime path.
                    post() {
                        setSzWarnLocation(undefined);
                    },
                    visitor: {
                        JSXAttribute(path: babel.NodePath<t.JSXAttribute>) {
                            const attrName = t.isJSXIdentifier(path.node.name)
                                ? path.node.name.name
                                : '';

                            // Piggyback: collect existing className/class string literal values.
                            // Only JSXAttribute nodes are visited here — text content, JSDoc,
                            // and string literals in other positions are different AST node
                            // types and never reach this visitor, eliminating false positives.
                            // These go into rawClassNames (TW JIT safelist only), NOT into
                            // collectedClasses, so they are never added to the mangle map.
                            if (attrName === 'className' || attrName === 'class') {
                                collectRawClassNameAttribute(path.node, rawClassNames);
                                return;
                            }

                            // szRecover handling: emit a recovery token + data-sz-recovery-token
                            // attribute so the runtime can match it against the manifest. Only
                            // string-literal modes (`csr` / `dev-only`) are processed; expression
                            // values (`szRecover={mode}`) are left untouched and warned about.
                            if (attrName === 'szRecover') {
                                if (
                                    transformRecoveryAttribute(
                                        path,
                                        filename,
                                        diagnostics,
                                        recoveryTokens,
                                    )
                                ) {
                                    transformed = true;
                                }
                                return;
                            }

                            // szs handling: compile each slot VALUE of the slot-map
                            // to its class string (keeping the key) so the component
                            // can forward `props.szs?.<slot>` into a child className.
                            // Only meaningful on custom components; the v1 contract
                            // (pure-literal object or class-string values, identifier
                            // keys) is enforced identically across all three engines.
                            if (attrName === 'szs') {
                                if (
                                    transformSzsAttribute(
                                        path,
                                        filename,
                                        options?.rootDir,
                                        diagnostics,
                                        szsPendingClasses,
                                    )
                                ) {
                                    transformed = true;
                                }
                                return;
                            }

                            if (attrName !== 'sz') {
                                return;
                            }

                            // Point the dev-mode unknown-property warning at this
                            // sz prop. Cleared in the visitor's `exit` so it never
                            // leaks to an unrelated later transform.
                            setSzWarnLocation(
                                formatSzWarnLocation(
                                    filename ?? 'file.tsx',
                                    path.node.loc?.start.line,
                                    options?.rootDir,
                                ),
                            );

                            const valueResult = transformSzAttributeValue(
                                path,
                                findExistingJsxAttributes(path),
                                classMergeUsage,
                                collectedClasses,
                                diagnostics,
                            );
                            transformed ||= valueResult.transformed;
                            usesColorVar ||= valueResult.usesColorVar;
                            usesSpacingVar ||= valueResult.usesSpacingVar;
                            usesUnitVar ||= valueResult.usesUnitVar;
                            usesSzcn ||= valueResult.usesSzcn;
                            usesSzPart ||= valueResult.usesSzPart;
                        },

                        // ── szv catalog extraction ────────────────────────────────────────
                        // When the compiler sees `const X = szv({...})` with a static config,
                        // it emits a no-op catalog array so Tailwind JIT can scan all variant
                        // class strings — even when szv is called at runtime with dynamic args.
                        VariableDeclarator(path: babel.NodePath<t.VariableDeclarator>) {
                            if (
                                extractSzvCatalog(
                                    path,
                                    collectedClasses,
                                    filename,
                                    options?.rootDir,
                                )
                            ) {
                                transformed = true;
                            }
                        },

                        // ── dynamic() / szr() literal extraction ─────────────────────────
                        // Detects `dynamic({...})` / `szr({...})` and their
                        // `(CONST_IDENTIFIER)` forms with statically-analyzable arguments
                        // and adds the resulting class tokens to collectedClasses so
                        // prescanAndWriteClasses() includes them in csszyx-classes.html
                        // for Tailwind to scan. A bare static `szr({...})` type-checks and
                        // resolves at runtime, so without this its classes were silently
                        // dead under Tailwind `source(none)`.
                        CallExpression(path: babel.NodePath<t.CallExpression>) {
                            collectRuntimeLiteralClasses(
                                path,
                                collectedClasses,
                                filename,
                                options?.rootDir,
                            );
                        },
                    },
                }),
            ],
        });

        // szs classes join AFTER every sz-derived class so the discovery order
        // (which fixes production mangle IDs) matches the other engines.
        for (const c of szsPendingClasses) {
            collectedClasses.add(c);
        }

        return {
            code: result?.code || source,
            transformed: transformed,
            usesRuntime: classMergeUsage.runtime,
            usesMerge: classMergeUsage.merge,
            usesSzcn: usesSzcn,
            usesSzPart: usesSzPart,
            usesColorVar: usesColorVar,
            usesSpacingVar: usesSpacingVar,
            usesUnitVar: usesUnitVar,
            classes: collectedClasses,
            rawClassNames,
            diagnostics,
            recoveryTokens,
            cssVariableMap,
        };
    } catch (e) {
        // Budget violations must propagate so the build aborts loudly with
        // a path the user can act on. Swallowing them would just hand back
        // unchanged source and let the OOM-prone file slip through.
        if (e instanceof ASTBudgetExceededError) {
            throw e;
        }
        console.warn('[csszyx] AST transform failed, falling back to original code:', e);
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
            classes: collectedClasses,
            rawClassNames,
            diagnostics,
            recoveryTokens,
            cssVariableMap,
        };
    }
}

/**
 * Extracts and inserts a static class catalog for one szv declaration.
 *
 * @param path Variable declarator path.
 * @param collectedClasses Shared class collection.
 * @param filename Source filename for diagnostics.
 * @param rootDir Project root for relative diagnostics.
 * @returns Whether a catalog declaration was inserted.
 */
function extractSzvCatalog(
    path: babel.NodePath<t.VariableDeclarator>,
    collectedClasses: Set<string>,
    filename?: string,
    rootDir?: string,
): boolean {
    const init = path.node.init;
    if (!isStaticSzvDeclaration(path.node, init)) return false;
    const config = resolveToConstObjectExpression(init.arguments[0], path.scope);
    if (!config) return false;

    const classStrings = collectSzvCatalogClasses(config, path.scope, init, filename, rootDir);
    if (classStrings.length === 0) return false;
    for (const classString of classStrings) addClassTokens(classString, collectedClasses);
    return insertSzvCatalogDeclaration(path, classStrings);
}

/**
 * Narrows a variable declarator to a named szv call with a config argument.
 *
 * @param declarator Variable declarator.
 * @param init Declarator initializer.
 * @returns Whether the declaration can produce a catalog.
 */
function isStaticSzvDeclaration(
    declarator: t.VariableDeclarator,
    init: t.Expression | null | undefined,
): init is t.CallExpression {
    return (
        t.isCallExpression(init) &&
        t.isIdentifier(init.callee) &&
        init.callee.name === 'szv' &&
        init.arguments.length > 0 &&
        t.isIdentifier(declarator.id)
    );
}

/**
 * Compiles every finite base and per-dimension variant candidate.
 *
 * @param config Static szv config object.
 * @param scope Babel scope used for const resolution.
 * @param init szv call expression.
 * @param filename Source filename for diagnostics.
 * @param rootDir Project root for relative diagnostics.
 * @returns Compiled catalog class strings.
 */
function collectSzvCatalogClasses(
    config: t.ObjectExpression,
    scope: babel.NodePath['scope'],
    init: t.CallExpression,
    filename?: string,
    rootDir?: string,
): string[] {
    const budget: CatalogExtrasBudget = {
        extras: MAX_CATALOG_BRANCH_EXTRAS,
        explores: MAX_CATALOG_BRANCH_EXTRAS,
        objectMemo: new Map(),
        valueMemo: new Map(),
    };
    const baseNode = readConfigSubObjectNode(config, 'base', scope);
    const baseCandidates = baseNode
        ? lenientCatalogObjects(baseNode, scope, new Set(), 0, budget)
        : [{} as SzObject];
    const base = baseCandidates[0] ?? ({} as SzObject);
    const classStrings: string[] = [];
    const warningLocation = formatSzWarnLocation(
        filename ?? 'file.tsx',
        init.loc?.start.line,
        rootDir,
    );
    setSzWarnLocation(warningLocation);
    try {
        for (const candidate of baseCandidates) compileCatalogObject(candidate, classStrings);
        collectSzvVariantClasses(config, scope, base, budget, classStrings);
    } finally {
        setSzWarnLocation(undefined);
    }
    return classStrings;
}

/**
 * Compiles one catalog object and appends a non-empty class string.
 *
 * @param object Static sz object.
 * @param classStrings Catalog output sink.
 */
function compileCatalogObject(object: SzObject, classStrings: string[]): void {
    const result = transform(object);
    const className = typeof result === 'string' ? result : result.className;
    if (className) classStrings.push(className);
}

/**
 * Compiles every readable variant value merged with the catalog base.
 *
 * @param config Static szv config object.
 * @param scope Babel scope used for const resolution.
 * @param base Static base styles.
 * @param budget Finite branch exploration budget.
 * @param classStrings Catalog output sink.
 */
function collectSzvVariantClasses(
    config: t.ObjectExpression,
    scope: babel.NodePath['scope'],
    base: SzObject,
    budget: CatalogExtrasBudget,
    classStrings: string[],
): void {
    const variants = readConfigSubObjectNode(config, 'variants', scope);
    for (const dimension of variants?.properties ?? []) {
        const values = resolveCatalogPropertyObject(dimension, scope);
        if (!values) continue;
        for (const variant of values.properties) {
            if (!t.isObjectProperty(variant) || variant.computed) continue;
            const candidates = lenientCatalogObjectCandidates(
                variant.value,
                scope,
                new Set(),
                0,
                budget,
            );
            for (const candidate of candidates) {
                compileCatalogObject({ ...base, ...candidate }, classStrings);
            }
        }
    }
}

/**
 * Resolves one variants dimension to an object expression.
 *
 * @param property Variants dimension property.
 * @param scope Babel scope used for const resolution.
 * @returns Resolved variants table, or null for unsupported shapes.
 */
function resolveCatalogPropertyObject(
    property: t.ObjectMethod | t.ObjectProperty | t.SpreadElement,
    scope: babel.NodePath['scope'],
): t.ObjectExpression | null {
    if (!t.isObjectProperty(property) || property.computed) return null;
    return resolveCatalogObjectExpression(property.value, scope, new Set());
}

/**
 * Inserts a no-op catalog declaration after its szv declaration.
 *
 * @param path Variable declarator path.
 * @param classStrings Compiled catalog class strings.
 * @returns Whether the declaration was inserted.
 */
function insertSzvCatalogDeclaration(
    path: babel.NodePath<t.VariableDeclarator>,
    classStrings: string[],
): boolean {
    if (!t.isIdentifier(path.node.id) || !path.parentPath?.isVariableDeclaration()) return false;
    const catalog = t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier(`_szv_catalog_${path.node.id.name}`),
            t.arrayExpression(classStrings.map(classString => t.stringLiteral(classString))),
        ),
    ]);
    path.parentPath.insertAfter(catalog);
    return true;
}

/**
 * Collects classes from a static dynamic()/szr() object or const reference.
 *
 * @param path Call-expression path.
 * @param collectedClasses Shared class collection.
 * @param filename Source filename for diagnostics.
 * @param rootDir Project root for relative diagnostics.
 */
function collectRuntimeLiteralClasses(
    path: babel.NodePath<t.CallExpression>,
    collectedClasses: Set<string>,
    filename?: string,
    rootDir?: string,
): void {
    const callee = path.node.callee;
    if (!isRuntimeLiteralCall(callee) || path.node.arguments.length === 0) return;
    const object = resolveRuntimeLiteralObject(path.node.arguments[0], path.scope);
    if (!object) return;

    const warningLocation =
        callee.name === 'szr'
            ? formatSzWarnLocation(filename ?? 'file.tsx', path.node.loc?.start.line, rootDir)
            : undefined;
    setSzWarnLocation(warningLocation);
    try {
        const result = transform(object);
        addClassTokens(result.className, collectedClasses);
    } finally {
        setSzWarnLocation(undefined);
    }
}

/**
 * Narrows a callee to a dynamic or szr identifier.
 *
 * @param callee Call-expression callee.
 * @returns Whether the call supports literal class extraction.
 */
function isRuntimeLiteralCall(
    callee: t.Expression | t.V8IntrinsicIdentifier,
): callee is t.Identifier {
    return t.isIdentifier(callee) && (callee.name === 'dynamic' || callee.name === 'szr');
}

/**
 * Resolves an inline object or same-scope const reference to a static sz object.
 *
 * @param argument First call argument.
 * @param scope Babel scope used for const resolution.
 * @returns Evaluated sz object, or null when dynamic.
 */
function resolveRuntimeLiteralObject(
    argument: t.CallExpression['arguments'][number],
    scope: babel.NodePath['scope'],
): SzObject | null {
    const unwrapped = unwrapTsExpression(argument);
    if (t.isObjectExpression(unwrapped)) {
        return (evaluateStaticObject(unwrapped) as SzObject | null) ?? null;
    }
    if (!t.isIdentifier(unwrapped)) return null;
    const binding = scope.getBinding(unwrapped.name);
    const declarator = binding?.path.node;
    if (!t.isVariableDeclarator(declarator) || !declarator.init) return null;
    const initializer = unwrapTsExpression(declarator.init);
    if (!t.isObjectExpression(initializer)) return null;
    return (evaluateStaticObject(initializer) as SzObject | null) ?? null;
}

/**
 * Parses a CSS inline string (e.g. "--tw-translate-y: -50%; transform: translate(...)")
 * into a Babel ObjectExpression containing the properties.
 * @param styleStr - The CSS string to parse
 * @returns A Babel ObjectExpression node representing the parsed styles
 */
function parseStyleStringToObjectExpr(styleStr: string): t.ObjectExpression {
    const props = styleStr
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);
    const objProps: t.ObjectProperty[] = [];
    for (const prop of props) {
        const idx = prop.indexOf(':');
        if (idx > -1) {
            const k = prop.slice(0, idx).trim();
            const v = prop.slice(idx + 1).trim();

            let keyNode: t.Identifier | t.StringLiteral;
            if (k.startsWith('--')) {
                keyNode = t.stringLiteral(k);
            } else {
                const camel = k.replace(/-([a-z])/g, g => g[1].toUpperCase());
                keyNode = t.identifier(camel);
            }
            objProps.push(t.objectProperty(keyNode, t.stringLiteral(v)));
        }
    }
    return t.objectExpression(objProps);
}

/** Scope binding resolver — wraps `path.scope.getBinding` for testability and optional use. */
type GetBinding = (name: string) => { path: babel.NodePath } | null | undefined;

/**
 * Whether a JSX opening-element name is a host (DOM) element — a plain
 * lowercase identifier like `div`. Uppercase identifiers and member
 * expressions (`Card.Header`) are custom components.
 *
 * @param name - the opening element's name node.
 * @returns true for a host element name.
 */
function isHostElementName(name: t.Node): boolean {
    return t.isJSXIdentifier(name) && /^[a-z]/.test(name.name);
}

/**
 * The shared unsupported-szs diagnostic — the exact contract (identifier keys,
 * pure-literal object or class-string values) is enforced identically by all
 * three engines so their outputs stay in parity.
 *
 * @param filename - source filename for context.
 * @returns the diagnostic message.
 */
function szsUnsupportedMessage(filename: string | undefined): string {
    return (
        `[csszyx] szs at ${filename ?? '<anonymous>'}: ` +
        'every slot must be an identifier key with a static object literal ' +
        '(or class string) value. Attribute left unchanged.'
    );
}

/**
 * Whether a value is allowed inside an szs slot object: string / number /
 * boolean literals, a negated number, or a nested object of the same. This is
 * deliberately STRICTER than the sz path (no identifiers, spreads,
 * conditionals, parens, or `as` casts) so all three engines can enforce the
 * exact same contract without a scope resolver.
 *
 * @param node - the candidate value node.
 * @returns true when the value is a pure literal.
 */
function isPureLiteralSzValue(node: t.Node): boolean {
    if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) {
        return true;
    }
    if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
        return true;
    }
    if (t.isObjectExpression(node)) {
        return node.properties.every(
            prop =>
                t.isObjectProperty(prop) &&
                !prop.computed &&
                t.isIdentifier(prop.key) &&
                isPureLiteralSzValue(prop.value as t.Node),
        );
    }
    return false;
}

/**
 * Whether an szs value is a valid v1 slot map: every property is a
 * non-computed identifier-keyed ObjectProperty whose value is a class string
 * or a pure-literal sz object.
 *
 * @param slotMap - the szs object expression.
 * @returns true when every slot satisfies the v1 contract.
 */
function isValidSzsSlotMap(slotMap: t.ObjectExpression): boolean {
    return slotMap.properties.every(
        prop =>
            t.isObjectProperty(prop) &&
            !prop.computed &&
            t.isIdentifier(prop.key) &&
            (t.isStringLiteral(prop.value) ||
                (t.isObjectExpression(prop.value) && isPureLiteralSzValue(prop.value))),
    );
}

/**
 * Replaces an empty-string class branch with `undefined` so a ternary used
 * directly as a className value (e.g. `cond ? 'pl-4' : {}`) renders no class
 * attribute on the empty branch instead of `class=""`. Only safe in value
 * position — never inside a template literal, where `${undefined}` would render
 * the text "undefined".
 *
 * @param node - the compiled class expression for one ternary branch.
 * @returns `undefined` identifier when the branch is an empty string, else the node unchanged.
 */
function emptyClassToUndefined(node: t.Expression): t.Expression {
    return t.isStringLiteral(node) && node.value === '' ? t.identifier('undefined') : node;
}

/**
 * Adds every non-empty class token from a compiled class string to a sink.
 *
 * @param className - Space-separated compiled class string.
 * @param classes - Class sink for the safelist.
 */
function addClassTokens(className: string, classes: Set<string>): void {
    for (const token of className.split(/\s+/)) {
        if (token) {
            classes.add(token);
        }
    }
}

/**
 * Safelist best-effort for a DYNAMIC sz array element: walk conditional /
 * logical branches and add the compiled classes of any static object literal
 * found, so `sz={[base, x ? { m: 2 } : { m: 8 }]}` still safelists both
 * branches even though the element itself resolves at runtime via `_szPart`.
 * Catalog-only — never affects the emitted code.
 *
 * @param node - The dynamic element expression.
 * @param getBinding - Scope lookup for identifier/spread resolution.
 * @param classes - Class sink for the safelist.
 */
function collectDynamicElementCandidates(
    node: t.Node,
    getBinding: GetBinding,
    classes: Set<string>,
): void {
    const inner = unwrapTsExpression(node);
    if (!inner) {
        return;
    }
    if (t.isConditionalExpression(inner)) {
        collectDynamicElementCandidates(inner.consequent, getBinding, classes);
        collectDynamicElementCandidates(inner.alternate, getBinding, classes);
        return;
    }
    if (t.isLogicalExpression(inner)) {
        collectDynamicElementCandidates(inner.right, getBinding, classes);
        return;
    }
    if (t.isStringLiteral(inner)) {
        addClassTokens(inner.value, classes);
        return;
    }
    const sz = tryResolveStaticSzObject(inner, getBinding);
    if (sz !== null) {
        addClassTokens(transform(sz).className, classes);
        return;
    }
    // Partially-static object literal (a runtime value blocked the full
    // resolve): walk it per property so the static siblings and both branches
    // of value-level conditionals still reach the safelist — matching the
    // oxc/rust engines, which already catalogue these.
    if (t.isObjectExpression(inner)) {
        collectPartialObjectCandidates(inner, getBinding, classes, []);
    }
}

/**
 * Wrap a leaf sz value back into nested objects along a key path:
 * (['hover','m'], 2) → { hover: { m: 2 } }.
 * @param path - Key path from the element root down to the leaf.
 * @param value - The leaf sz value.
 * @returns The nested single-leaf sz object.
 */
function wrapSzPath(path: readonly string[], value: SzValue): SzObject {
    let wrapped: SzValue = value;
    for (let i = path.length - 1; i >= 0; i--) {
        wrapped = { [path[i]]: wrapped } as unknown as SzValue;
    }
    return wrapped as unknown as SzObject;
}

/**
 * Compile a single leaf value at a key path and add its classes to the
 * safelist, ignoring values the transform rejects.
 * @param path - Key path from the element root down to the leaf.
 * @param value - The leaf sz value.
 * @param classes - Safelist accumulator.
 */
function addPartialLeafClasses(
    path: readonly string[],
    value: SzValue,
    classes: Set<string>,
): void {
    try {
        for (const c of transform(wrapSzPath(path, value)).className.split(/\s+/)) {
            if (c) {
                classes.add(c);
            }
        }
    } catch {
        // Pathological value (depth guard etc.) — safelist is best-effort.
    }
}

/**
 * Best-effort safelist walk of a partially-static object literal: static
 * values compile at their key path, conditional values compile both branches,
 * nested objects recurse, spreads re-enter the element collector.
 * @param node - The object literal to walk.
 * @param getBinding - Scope lookup for identifier/spread resolution.
 * @param classes - Safelist accumulator.
 * @param path - Key path accumulated from the element root.
 */
function collectPartialObjectCandidates(
    node: t.ObjectExpression,
    getBinding: GetBinding,
    classes: Set<string>,
    path: readonly string[],
): void {
    for (const prop of node.properties) {
        if (t.isSpreadElement(prop)) {
            collectDynamicElementCandidates(prop.argument, getBinding, classes);
            continue;
        }
        if (!t.isObjectProperty(prop) || prop.computed) {
            continue;
        }
        const key = t.isIdentifier(prop.key)
            ? prop.key.name
            : t.isStringLiteral(prop.key)
              ? prop.key.value
              : null;
        if (key === null || !t.isExpression(prop.value)) {
            continue;
        }
        collectPartialValueCandidates(prop.value, [...path, key], getBinding, classes);
    }
}

/**
 * Resolve one property value in the partial-object walk: literals compile,
 * conditionals recurse into both branches, objects resolve fully or recurse.
 * @param valueNode - The property value expression.
 * @param path - Key path from the element root to this property.
 * @param getBinding - Scope lookup for identifier/spread resolution.
 * @param classes - Safelist accumulator.
 */
function collectPartialValueCandidates(
    valueNode: t.Expression,
    path: readonly string[],
    getBinding: GetBinding,
    classes: Set<string>,
): void {
    const value = unwrapTsExpression(valueNode);
    if (!value || !t.isExpression(value)) {
        return;
    }
    if (t.isConditionalExpression(value)) {
        collectPartialValueCandidates(value.consequent, path, getBinding, classes);
        collectPartialValueCandidates(value.alternate, path, getBinding, classes);
        return;
    }
    if (t.isObjectExpression(value)) {
        const nested = tryResolveStaticSzObject(value, getBinding);
        if (nested !== null) {
            addPartialLeafClasses(path, nested as unknown as SzValue, classes);
        } else {
            collectPartialObjectCandidates(value, getBinding, classes, path);
        }
        return;
    }
    const literal = extractStaticLiteralValue(value);
    if (literal !== null) {
        addPartialLeafClasses(path, literal, classes);
    }
}

/**
 * Diagnostic for an array element that is a visible object literal but still
 * degrades to `_szPart` because one of its values is a runtime expression.
 * @param node - The degraded array element.
 * @returns The formatted diagnostic string.
 */
function buildSzPartElementDiagnostic(node: t.Node): string {
    const loc = node.loc;
    const lineCol = loc ? `${loc.start.line}:${loc.start.column + 1}` : '?';
    return (
        `sz array element at ${lineCol}: this object literal contains a runtime ` +
        'value, so the whole element is deferred to _szPart at runtime (its classes are ' +
        'still safelisted best-effort).\n  Suggestion: lift the condition to the element ' +
        'level (cond ? { a } : { b }) or move runtime values to dynamic().'
    );
}

/**
 * Resolve a node to a static {@link SzObject} WITHOUT compiling it — the sz
 * array composition lane needs the object itself so elements can deep-merge
 * before a single compile. Handles TS wrappers, object literals with resolved
 * spreads, and identifiers bound to such objects (any binding kind, matching
 * `tryStaticTransformNode`'s resolution).
 *
 * @param node - The candidate array element (already TS-unwrapped or not).
 * @param getBinding - Scope lookup for identifier/spread resolution.
 * @returns The static sz object, or null when the element is dynamic.
 */
function tryResolveStaticSzObject(node: t.Node, getBinding?: GetBinding): SzObject | null {
    const inner = unwrapTsExpression(node);
    if (!inner) {
        return null;
    }
    if (t.isObjectExpression(inner)) {
        const resolved = getBinding ? (resolveObjectSpreads(inner, getBinding) ?? inner) : inner;
        return evaluateStaticObject(resolved);
    }
    if (t.isIdentifier(inner) && getBinding) {
        const binding = getBinding(inner.name);
        if (binding?.path.isVariableDeclarator()) {
            const init = binding.path.node.init;
            if (init) {
                return tryResolveStaticSzObject(init, getBinding);
            }
        }
    }
    return null;
}

/**
 * Resolve a node to its compiled class-string expression when statically
 * possible: object literals (spreads resolved), string literals, identifiers
 * bound to either, and conditionals whose branches all resolve. Returns null
 * when the node needs the runtime.
 *
 * @param node - The candidate sz value node.
 * @param getBinding - Scope lookup for identifier/spread resolution.
 * @returns A compiled expression (string literal or conditional of them), or null.
 */
function tryStaticTransformNode(node: t.Node, getBinding?: GetBinding): t.Expression | null {
    // Unwrap TypeScript type assertions — `as const` and `satisfies T` wrap the real node
    // in TSAsExpression / TSSatisfiesExpression; strip them before any type checks.
    if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node)) {
        return tryStaticTransformNode(node.expression, getBinding);
    }

    // Static object: { p: 4, bg: 'blue-500' } → "p-4 bg-blue-500"
    if (t.isObjectExpression(node)) {
        return tryStaticObjectTransform(node, getBinding);
    }

    // Already a string literal: pass through
    if (t.isStringLiteral(node)) {
        return node;
    }

    // Identifier: resolve the binding and recurse — handles sz={var}, array elements,
    // and ternary branches that are variable references rather than inline objects.
    if (t.isIdentifier(node) && getBinding) {
        return tryStaticIdentifierTransform(node, getBinding);
    }

    // Conditional expression: cond ? {...} : {...}
    // Recursively resolve both branches
    if (t.isConditionalExpression(node)) {
        return tryStaticConditionalTransform(node, getBinding);
    }

    // Unary expression for negative numbers: not applicable here, skip
    return null;
}

/**
 * Compile an object literal or its hoistable conditional spread.
 * @param node - Object literal to compile.
 * @param getBinding - Optional scope binding lookup.
 * @returns Static class expression, or null.
 */
function tryStaticObjectTransform(
    node: t.ObjectExpression,
    getBinding?: GetBinding,
): t.Expression | null {
    const resolved = getBinding ? (resolveObjectSpreads(node, getBinding) ?? node) : node;
    const staticObject = evaluateStaticObject(resolved);
    if (staticObject !== null) return t.stringLiteral(transform(staticObject).className);
    return getBinding ? tryHoistConditionalSpread(node, getBinding) : null;
}

/**
 * Resolve and statically transform one bound identifier.
 * @param node - Identifier to resolve.
 * @param getBinding - Scope binding lookup.
 * @returns Static class expression, or null.
 */
function tryStaticIdentifierTransform(
    node: t.Identifier,
    getBinding: GetBinding,
): t.Expression | null {
    const binding = getBinding(node.name);
    if (!binding?.path.isVariableDeclarator()) return null;
    const initializer = binding.path.node.init;
    return initializer ? tryStaticTransformNode(initializer, getBinding) : null;
}

/**
 * Statically transform both branches of a conditional expression.
 * @param node - Conditional expression to compile.
 * @param getBinding - Optional scope binding lookup.
 * @returns Compiled conditional, or null when either branch is dynamic.
 */
function tryStaticConditionalTransform(
    node: t.ConditionalExpression,
    getBinding?: GetBinding,
): t.Expression | null {
    const consequent = tryStaticTransformNode(node.consequent, getBinding);
    const alternate = tryStaticTransformNode(node.alternate, getBinding);
    return consequent !== null && alternate !== null
        ? t.conditionalExpression(
              node.test,
              emptyClassToUndefined(consequent),
              emptyClassToUndefined(alternate),
          )
        : null;
}

/**
 * Counts ConditionalExpressions that appear as a (possibly nested) property value
 * in an object literal, and captures the test of the first one found. A finite
 * conditional inside a value — e.g. `borderColor: { color: cond ? 'red-700' :
 * 'charcoal', op: 18 }` — is what the native engine expands into both branches.
 *
 * @param node - object literal to scan.
 * @returns the count and the first conditional's test (null test when count 0).
 */
function scanNestedConditionals(node: t.ObjectExpression): {
    topLevel: number;
    nested: number;
    test: t.Expression | null;
} {
    let topLevel = 0;
    let nested = 0;
    let test: t.Expression | null = null;
    for (const prop of node.properties) {
        if (!t.isObjectProperty(prop)) {
            continue;
        }
        const value = prop.value;
        if (t.isConditionalExpression(value)) {
            // A direct property conditional (`scale: cond ? 75 : 100`) is handled
            // better by the partial path, which factors the static classes out.
            topLevel++;
        } else if (t.isObjectExpression(value)) {
            nested += countAllConditionals(value);
            test ??= firstConditionalTest(value);
        }
    }
    return { topLevel, nested, test };
}

/**
 * Total ConditionalExpressions appearing as a (possibly nested) value in `node`.
 *
 * @param node - object literal to scan.
 * @returns the count.
 */
function countAllConditionals(node: t.ObjectExpression): number {
    let count = 0;
    for (const prop of node.properties) {
        if (!t.isObjectProperty(prop)) {
            continue;
        }
        const value = prop.value;
        if (t.isConditionalExpression(value)) {
            count++;
        } else if (t.isObjectExpression(value)) {
            count += countAllConditionals(value);
        }
    }
    return count;
}

/**
 * The test of the first ConditionalExpression appearing as a (possibly nested)
 * property value, or null.
 *
 * @param node - object literal to scan.
 * @returns the first conditional's test, or null.
 */
function firstConditionalTest(node: t.ObjectExpression): t.Expression | null {
    for (const prop of node.properties) {
        if (!t.isObjectProperty(prop)) {
            continue;
        }
        const value = prop.value;
        if (t.isConditionalExpression(value)) {
            return value.test;
        }
        if (t.isObjectExpression(value)) {
            const inner = firstConditionalTest(value);
            if (inner) {
                return inner;
            }
        }
    }
    return null;
}

/**
 * Deep-clones `node`, replacing the single nested ConditionalExpression value
 * with its `pick` branch, so the result is a plain static object for that branch.
 *
 * @param node - object literal (assumed to hold exactly one nested conditional).
 * @param pick - which branch to substitute.
 * @returns the branch-specialized object clone.
 */
function cloneObjectPickingBranch(
    node: t.ObjectExpression,
    pick: 'consequent' | 'alternate',
): t.ObjectExpression {
    return t.objectExpression(
        node.properties.map(prop => {
            if (!t.isObjectProperty(prop)) {
                return t.cloneNode(prop);
            }
            const value = prop.value;
            let nextValue: t.ObjectProperty['value'] = t.cloneNode(value);
            if (t.isConditionalExpression(value)) {
                nextValue = t.cloneNode(value[pick]) as t.ObjectProperty['value'];
            } else if (t.isObjectExpression(value)) {
                nextValue = cloneObjectPickingBranch(value, pick);
            }
            return t.objectProperty(
                t.cloneNode(prop.key),
                nextValue,
                prop.computed,
                prop.shorthand,
            );
        }),
    );
}

/**
 * Hoist a single finite conditional nested in a value (`{ color: cond ? a : b }`)
 * outward into a class-level ternary: compile the object with each branch and emit
 * `cond ? "classesA" : "classesB"`. Matches the native engine, which expands the
 * finite choice statically instead of falling through to runtime / a CSS variable.
 *
 * Only ONE nested conditional per object (a second would expand combinatorially);
 * more than one returns null and the existing paths handle it.
 *
 * @param node - object literal that may hold one nested conditional value.
 * @param getBinding - scope binding resolver.
 * @returns a ConditionalExpression of two static class strings, or null.
 */
function tryHoistNestedConditional(
    node: t.ObjectExpression,
    getBinding: GetBinding,
): t.Expression | null {
    const { topLevel, nested, test } = scanNestedConditionals(node);
    // Only handle a single conditional nested inside a sub-object value. A
    // top-level conditional prop is left to the partial path (it factors the
    // static classes out instead of repeating them in both branches).
    if (topLevel !== 0 || nested !== 1 || test === null) {
        return null;
    }

    // Factor like the native engine: the non-conditional props emit once as a
    // static prefix, and only the conditional prop varies inside the ternary
    // (`bg-white/70 ${cond ? "border-red-700/18" : "border-charcoal/18"}`).
    // Repeating the static classes in both branches yielded the same class SET but
    // a different discovery ORDER, so mangle IDs (assigned in discovery order)
    // diverged from Rust/oxc.
    const condPropIndex = node.properties.findIndex(
        prop =>
            t.isObjectProperty(prop) &&
            t.isObjectExpression(prop.value) &&
            countAllConditionals(prop.value) === 1,
    );
    if (condPropIndex === -1) {
        return null;
    }
    const staticNode = t.objectExpression(node.properties.filter((_, i) => i !== condPropIndex));
    const condNode = t.objectExpression([node.properties[condPropIndex]]);

    const staticClasses =
        staticNode.properties.length > 0 ? tryStaticTransformNode(staticNode, getBinding) : null;
    const consequent = tryStaticTransformNode(
        cloneObjectPickingBranch(condNode, 'consequent'),
        getBinding,
    );
    const alternate = tryStaticTransformNode(
        cloneObjectPickingBranch(condNode, 'alternate'),
        getBinding,
    );
    if (
        !consequent ||
        !alternate ||
        !t.isStringLiteral(consequent) ||
        !t.isStringLiteral(alternate) ||
        (staticNode.properties.length > 0 && (!staticClasses || !t.isStringLiteral(staticClasses)))
    ) {
        return null;
    }

    const ternary = t.conditionalExpression(
        test,
        emptyClassToUndefined(consequent),
        emptyClassToUndefined(alternate),
    );
    if (!staticClasses || !t.isStringLiteral(staticClasses) || staticClasses.value === '') {
        return ternary;
    }
    // `${staticClasses} ${cond ? "…" : "…"}` — discovery order: static, then the
    // consequent branch, then the alternate branch (matches Rust/oxc).
    return t.templateLiteral(
        [
            t.templateElement(
                { raw: `${staticClasses.value} `, cooked: `${staticClasses.value} ` },
                false,
            ),
            t.templateElement({ raw: '', cooked: '' }, true),
        ],
        [ternary],
    );
}

/**
 * Handles sz={{ ...(cond ? varA : varB), staticKey: 'val' }} by hoisting the ternary outward.
 *
 * Strategy: find a single conditional spread inside the object, replace it with each branch
 * in turn, and recursively try to resolve the two resulting flat objects. If both resolve to
 * static class strings, return a ConditionalExpression of the two strings.
 *
 * Only handles exactly ONE conditional spread per object. Multiple conditional spreads or
 * any other unresolvable spread causes an immediate null return.
 *
 * @param node - ObjectExpression that may contain a conditional spread
 * @param getBinding - Scope binding resolver
 * @returns ConditionalExpression of two StringLiterals, or null if pattern doesn't match
 */
function tryHoistConditionalSpread(
    node: t.ObjectExpression,
    getBinding: GetBinding,
): t.Expression | null {
    // Locate conditional spreads and reject if any non-conditional spread remains unresolved
    let conditionalSpreadIdx = -1;
    let conditionalExpr: t.ConditionalExpression | null = null;

    for (let i = 0; i < node.properties.length; i++) {
        const prop = node.properties[i];
        if (!t.isSpreadElement(prop)) {
            continue;
        }

        if (t.isConditionalExpression(prop.argument)) {
            // Allow exactly one conditional spread
            if (conditionalSpreadIdx !== -1) {
                return null;
            }
            conditionalSpreadIdx = i;
            conditionalExpr = prop.argument;
        } else {
            // Any other unresolved spread (e.g. imported var) → can't hoist
            return null;
        }
    }

    if (conditionalSpreadIdx === -1 || conditionalExpr === null) {
        return null;
    }

    // Build two ObjectExpressions — one per branch — then resolve each recursively.
    // The conditional spread is replaced by a plain identifier spread for that branch.
    const otherProps = node.properties.filter((_, i) => i !== conditionalSpreadIdx);
    const mkObj = (branch: t.Expression): t.ObjectExpression =>
        t.objectExpression([t.spreadElement(branch), ...otherProps]);

    const resolvedA = tryStaticTransformNode(mkObj(conditionalExpr.consequent), getBinding);
    const resolvedB = tryStaticTransformNode(mkObj(conditionalExpr.alternate), getBinding);

    // Both branches must fully resolve to static strings (no dynamic props allowed)
    if (!resolvedA || !resolvedB) {
        return null;
    }
    if (!t.isStringLiteral(resolvedA) || !t.isStringLiteral(resolvedB)) {
        return null;
    }

    return t.conditionalExpression(
        conditionalExpr.test,
        emptyClassToUndefined(resolvedA),
        emptyClassToUndefined(resolvedB),
    );
}

/**
 * Read a single named property (`base` / `variants`) of an szv config as an
 * OBJECT NODE, without converting it. Returns null when the key is absent or
 * its value is not an object literal / const-bound object — so sibling keys
 * (compoundVariants, defaultVariants, unknown keys) never affect the catalog.
 *
 * @param configExpr The szv config object expression.
 * @param key The property to read (e.g. 'base' or 'variants').
 * @param scope The babel scope at the szv call site (for const-binding resolution).
 * @returns The sub-object node, or null.
 */
function readConfigSubObjectNode(
    configExpr: t.ObjectExpression,
    key: string,
    scope: babel.NodePath['scope'],
): t.ObjectExpression | null {
    for (const prop of configExpr.properties) {
        if (!t.isObjectProperty(prop) || prop.computed) {
            continue;
        }
        const k = t.isIdentifier(prop.key)
            ? prop.key.name
            : t.isStringLiteral(prop.key)
              ? prop.key.value
              : null;
        if (k !== key) {
            continue;
        }
        return resolveToConstObjectExpression(prop.value, scope);
    }
    return null;
}

/** Nesting cap for the lenient catalog walk (matches the Rust/oxc walkers). */
const MAX_CATALOG_DEPTH = 16;

/**
 * Cap on alternate-branch objects one szv call may add to the catalog, so a
 * pathological conditional pile-up cannot balloon the safelist walk.
 * (Matches the Rust/oxc walkers.)
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
     * `extras` already documents. (Matches the Rust/oxc walkers.)
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
    objectMemo: Map<t.Node, SzObject[]>;
    valueMemo: Map<t.Node, SzValue[]>;
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
 * Resolve an identifier to its const initializer (const-only, never
 * reassigned), unwrapped of TS-only wrappers. Used by the szv catalog's
 * lenient leaf resolution (`mx: GUTTER` where `const GUTTER = 0`).
 *
 * @param name Identifier name to resolve.
 * @param scope The babel scope at the szv call site.
 * @returns The unwrapped initializer node, or null.
 */
function resolveConstInitializer(name: string, scope: babel.NodePath['scope']): t.Node | null {
    const binding = scope.getBinding(name);
    if (binding?.kind !== 'const' || !binding.constant) {
        return null;
    }
    const declNode = binding.path.node;
    if (!t.isVariableDeclarator(declNode)) {
        return null;
    }
    return unwrapTsExpression(declNode.init) ?? null;
}

/**
 * Merge catalog candidates produced by one object spread.
 *
 * @param argument Spread argument to resolve.
 * @param primary Primary catalog object under construction.
 * @param extras Alternate catalog objects under construction.
 * @param scope Babel scope at the szv call site.
 * @param seen Identifier cycle guard.
 * @param depth Current catalog depth.
 * @param budget Remaining alternate-branch allowance.
 */
function mergeCatalogSpread(
    argument: t.Expression,
    primary: Record<string, SzValue>,
    extras: SzObject[],
    scope: babel.NodePath['scope'],
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): void {
    const [first, ...rest] = lenientCatalogObjectCandidates(
        argument,
        scope,
        seen,
        depth + 1,
        budget,
    );
    if (first) {
        Object.assign(primary, first);
    }
    for (const extra of rest) {
        pushCatalogExtra(extras, extra, budget);
    }
}

/**
 * Merge catalog candidates produced by one static object property.
 *
 * @param prop Object property to classify.
 * @param primary Primary catalog object under construction.
 * @param extras Alternate catalog objects under construction.
 * @param scope Babel scope at the szv call site.
 * @param seen Identifier cycle guard.
 * @param depth Current catalog depth.
 * @param budget Remaining alternate-branch allowance.
 */
function mergeCatalogProperty(
    prop: t.ObjectProperty,
    primary: Record<string, SzValue>,
    extras: SzObject[],
    scope: babel.NodePath['scope'],
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): void {
    const key = getObjectPropertyKey(prop);
    if (key === null) {
        return;
    }
    const [firstValue, ...restValues] = lenientCatalogValues(
        prop.value,
        scope,
        seen,
        depth + 1,
        budget,
    );
    if (firstValue === undefined) {
        return;
    }
    primary[key] = firstValue;
    for (const value of restValues) {
        pushCatalogExtra(extras, { [key]: value } as SzObject, budget);
    }
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
 * @param scope The babel scope at the szv call site.
 * @param seen Identifier names already followed (cycle guard).
 * @param depth Current nesting depth.
 * @param budget Remaining alternate-branch allowance for this szv call.
 * @returns Candidate objects; primary always present at index 0.
 */
function lenientCatalogObjects(
    node: t.ObjectExpression,
    scope: babel.NodePath['scope'],
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzObject[] {
    if (depth > MAX_CATALOG_DEPTH) {
        return [{} as SzObject];
    }
    const primary: Record<string, SzValue> = {};
    const extras: SzObject[] = [];
    for (const prop of node.properties) {
        if (t.isSpreadElement(prop)) {
            mergeCatalogSpread(prop.argument, primary, extras, scope, seen, depth, budget);
            continue;
        }
        if (!t.isObjectProperty(prop) || prop.computed) {
            continue;
        }
        mergeCatalogProperty(prop, primary, extras, scope, seen, depth, budget);
    }
    return [primary as SzObject, ...extras];
}

/**
 * Classify one leaf value into catalog candidates. Empty result = skip the
 * key. Finite conditionals contribute BOTH branches (the runtime resolves one
 * of them, so both classes must exist); `null`/`undefined` mean "key unset";
 * const identifiers resolve through their initializer (const-only, cycle
 * guarded); everything else — calls, members, templates — is skipped.
 *
 * @param node Value node to classify.
 * @param scope The babel scope at the szv call site.
 * @param seen Identifier names already followed (cycle guard).
 * @param depth Current nesting depth.
 * @param budget Remaining alternate-branch allowance for this szv call.
 * @returns Candidate values in branch order (consequent first).
 */
function lenientCatalogValues(
    node: t.Node | null | undefined,
    scope: babel.NodePath['scope'],
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzValue[] {
    if (depth > MAX_CATALOG_DEPTH) {
        return [];
    }
    const value = unwrapTsExpression(node);
    if (!value) {
        return [];
    }
    const literal = catalogLiteralValues(value);
    if (literal !== null) return literal;
    if (t.isObjectExpression(value)) {
        return lenientCatalogObjects(value, scope, seen, depth, budget);
    }
    if (t.isConditionalExpression(value)) {
        return catalogConditionalValues(value, scope, seen, depth, budget);
    }
    if (t.isIdentifier(value)) {
        return catalogIdentifierValues(value, scope, seen, depth, budget);
    }
    return [];
}

/**
 * Classify primitive and signed numeric catalog values.
 * @param value - Babel node to classify.
 * @returns Candidate values, or null when this helper does not own the shape.
 */
function catalogLiteralValues(value: t.Node): SzValue[] | null {
    if (t.isStringLiteral(value) || t.isNumericLiteral(value) || t.isBooleanLiteral(value)) {
        return [value.value];
    }
    if (t.isNullLiteral(value)) return [];
    if (!t.isUnaryExpression(value) || !t.isNumericLiteral(value.argument)) return null;
    if (value.operator === '-') return [-value.argument.value];
    return value.operator === '+' ? [value.argument.value] : [];
}

/**
 * Explore the bounded branches of one catalog conditional.
 * @param value - Conditional value to explore.
 * @param scope - Babel scope for identifier resolution.
 * @param seen - Identifier cycle guard.
 * @param depth - Current catalog depth.
 * @param budget - Alternate-branch budget and memo.
 * @returns Bounded branch values in source order.
 */
function catalogConditionalValues(
    value: t.ConditionalExpression,
    scope: babel.NodePath['scope'],
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzValue[] {
    const values = lenientCatalogValues(value.consequent, scope, seen, depth, budget);
    if (budget.explores > 0) {
        budget.explores -= 1;
        values.push(...lenientCatalogValues(value.alternate, scope, seen, depth, budget));
    }
    return truncateCatalogCandidates(values, budget);
}

/**
 * Resolve one const identifier through the bounded catalog memo.
 * @param value - Const identifier to resolve.
 * @param scope - Babel scope for identifier resolution.
 * @param seen - Identifier cycle guard.
 * @param depth - Current catalog depth.
 * @param budget - Alternate-branch budget and memo.
 * @returns Memoized candidate values.
 */
function catalogIdentifierValues(
    value: t.Identifier,
    scope: babel.NodePath['scope'],
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzValue[] {
    if (value.name === 'undefined' || seen.has(value.name)) return [];
    const initializer = resolveConstInitializer(value.name, scope);
    if (!initializer) return [];
    const cached = budget.valueMemo.get(initializer);
    if (cached) return [...cached];
    const values = lenientCatalogValues(
        initializer,
        scope,
        new Set([...seen, value.name]),
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
 * @param scope The babel scope at the szv call site.
 * @param seen Identifier names already followed (cycle guard).
 * @param depth Current nesting depth.
 * @param budget Remaining alternate-branch allowance for this szv call.
 * @returns Candidate objects; empty when the position is not object-like.
 */
function lenientCatalogObjectCandidates(
    node: t.Node | null | undefined,
    scope: babel.NodePath['scope'],
    seen: ReadonlySet<string>,
    depth: number,
    budget: CatalogExtrasBudget,
): SzObject[] {
    if (depth > MAX_CATALOG_DEPTH) {
        return [];
    }
    const value = unwrapTsExpression(node);
    if (!value) {
        return [];
    }
    if (t.isObjectExpression(value)) {
        return lenientCatalogObjects(value, scope, seen, depth, budget);
    }
    if (t.isConditionalExpression(value)) {
        const candidates = lenientCatalogObjectCandidates(
            value.consequent,
            scope,
            seen,
            depth,
            budget,
        );
        // Same paid-exploration guard as the values lane.
        if (budget.explores > 0) {
            budget.explores -= 1;
            candidates.push(
                ...lenientCatalogObjectCandidates(value.alternate, scope, seen, depth, budget),
            );
        }
        return truncateCatalogCandidates(candidates, budget);
    }
    if (t.isIdentifier(value)) {
        if (seen.has(value.name)) {
            return [];
        }
        const init = resolveConstInitializer(value.name, scope);
        if (!init) {
            return [];
        }
        const cached = budget.objectMemo.get(init);
        if (cached) {
            return [...cached];
        }
        const candidates = lenientCatalogObjectCandidates(
            init,
            scope,
            new Set([...seen, value.name]),
            depth,
            budget,
        );
        budget.objectMemo.set(init, candidates);
        return [...candidates];
    }
    return [];
}

/**
 * Resolve a node to an object expression through const bindings (used for
 * variant DIMENSION values, which cannot fork into candidates).
 *
 * @param node Node to resolve.
 * @param scope The babel scope at the szv call site.
 * @param seen Identifier names already followed (cycle guard).
 * @returns Object expression, or null.
 */
function resolveCatalogObjectExpression(
    node: t.Node | null | undefined,
    scope: babel.NodePath['scope'],
    seen: ReadonlySet<string>,
): t.ObjectExpression | null {
    const value = unwrapTsExpression(node);
    if (!value) {
        return null;
    }
    if (t.isObjectExpression(value)) {
        return value;
    }
    if (t.isIdentifier(value) && !seen.has(value.name)) {
        const init = resolveConstInitializer(value.name, scope);
        if (!init) {
            return null;
        }
        return resolveCatalogObjectExpression(init, scope, new Set([...seen, value.name]));
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
 * Peel TypeScript-only wrapper expressions (`satisfies`, `as`, non-null `!`,
 * parentheses) off a node. They are type-level annotations with no runtime
 * effect, so extraction must look straight through them — `{...} satisfies
 * Record<Token, object>` is the natural way to keep a variant table complete
 * against a union, and it used to silently disable szv extraction.
 *
 * @param node - The node to unwrap.
 * @returns The innermost non-wrapper expression node.
 */
function unwrapTsExpression(node: t.Node | null | undefined): t.Node | null | undefined {
    let current = node;
    while (
        t.isTSSatisfiesExpression(current) ||
        t.isTSAsExpression(current) ||
        t.isTSNonNullExpression(current) ||
        t.isParenthesizedExpression(current)
    ) {
        current = current.expression;
    }
    return current;
}

/**
 * Resolve a node to an object-literal expression: it either IS one, or is a
 * same-scope `const` identifier bound to one. A reassigned binding (babel reports
 * `binding.constant === false`) or any non-object initializer returns null — so
 * szv follows `const cfg = {…}; szv(cfg)` but never a mutated `let`.
 *
 * @param node - The node to resolve (config arg or a base/variants value).
 * @param scope - The babel scope at the szv call site.
 * @returns The object expression, or null.
 */
function resolveToConstObjectExpression(
    node: t.Node | null | undefined,
    scope: babel.NodePath['scope'],
): t.ObjectExpression | null {
    const unwrapped = unwrapTsExpression(node);
    if (t.isObjectExpression(unwrapped)) {
        return unwrapped;
    }
    if (t.isIdentifier(unwrapped)) {
        const binding = scope.getBinding(unwrapped.name);
        // `const`-declared only (matches the oxc const-binding map + the Rust
        // VariableDeclarationKind::Const guard), AND never reassigned.
        if (binding?.kind === 'const' && binding.constant) {
            const declNode = binding.path.node;
            if (t.isVariableDeclarator(declNode)) {
                const init = unwrapTsExpression(declNode.init);
                if (t.isObjectExpression(init)) {
                    return init;
                }
            }
        }
    }
    return null;
}

/**
 * Evaluate one AST value when it is representable in a static SzObject.
 *
 * @param value AST value to evaluate.
 * @returns Static sz value, or undefined when dynamic.
 */
function evaluateStaticValue(value: t.Node | null | undefined): SzValue | undefined {
    const unwrapped = unwrapTsExpression(value);
    if (t.isStringLiteral(unwrapped) || t.isNumericLiteral(unwrapped)) {
        return unwrapped.value;
    }
    if (t.isBooleanLiteral(unwrapped)) {
        return unwrapped.value;
    }
    if (
        t.isUnaryExpression(unwrapped) &&
        unwrapped.operator === '-' &&
        t.isNumericLiteral(unwrapped.argument)
    ) {
        return -unwrapped.argument.value;
    }
    return t.isObjectExpression(unwrapped)
        ? (evaluateStaticObject(unwrapped) ?? undefined)
        : undefined;
}

/**
 * Evaluate an ObjectExpression to a plain SzObject when every property (and
 * nested object) is a static literal. Returns null on the first dynamic value.
 *
 * @param node The object expression to evaluate.
 * @returns The static SzObject, or null if any part is dynamic.
 */
function evaluateStaticObject(node: t.ObjectExpression): SzObject | null {
    const result: SzObject = {};

    for (const prop of node.properties) {
        if (!t.isObjectProperty(prop) || prop.computed) {
            return null;
        }
        const key = getObjectPropertyKey(prop);
        const value = evaluateStaticValue(prop.value);
        if (key === null || value === undefined) {
            return null;
        }
        result[key] = value;
    }

    return result;
}

// ============================================================================
// SPREAD RESOLUTION: Flatten local-variable spreads into plain properties
// ============================================================================

/**
 * Resolves SpreadElement nodes in an ObjectExpression by looking up local
 * variable bindings in the current scope.
 *
 * Only handles `{ ...identifier }` where the identifier is bound to a plain
 * object literal in the same file (const/let). Imported variables, computed
 * spreads, and dynamic initializers all return null, allowing the caller to
 * fall back gracefully.
 *
 * Recursive: spreads inside the referenced variable are also resolved.
 *
 * @param node - The ObjectExpression whose SpreadElements to flatten
 * @param getBinding - Scope lookup (pass `(name) => path.scope.getBinding(name)`)
 * @returns A new flat ObjectExpression, or null if any spread can't be resolved
 */
function resolveObjectSpreads(
    node: t.ObjectExpression,
    getBinding: (name: string) => { path: babel.NodePath } | null | undefined,
): t.ObjectExpression | null {
    const newProps: t.ObjectExpression['properties'] = [];
    for (const prop of node.properties) {
        const resolved = resolveObjectSpreadProperty(prop, getBinding);
        if (resolved === null) return null;
        newProps.push(...resolved);
    }
    return t.objectExpression(newProps);
}

/**
 * Resolve one regular property or local identifier spread.
 * @param prop - Property or spread to resolve.
 * @param getBinding - Scope binding lookup.
 * @returns Resolved properties, or null when resolution is unsafe.
 */
function resolveObjectSpreadProperty(
    prop: t.ObjectExpression['properties'][number],
    getBinding: (name: string) => { path: babel.NodePath } | null | undefined,
): t.ObjectExpression['properties'] | null {
    if (!t.isSpreadElement(prop)) {
        if (!t.isObjectProperty(prop) || !t.isObjectExpression(prop.value)) return [prop];
        const value = resolveObjectSpreads(prop.value, getBinding);
        return value ? [t.objectProperty(prop.key, value, prop.computed, prop.shorthand)] : null;
    }
    if (!t.isIdentifier(prop.argument)) return null;
    const binding = getBinding(prop.argument.name);
    if (!binding?.path.isVariableDeclarator()) return null;
    let init = binding.path.node.init;
    if (t.isTSAsExpression(init) || t.isTSSatisfiesExpression(init)) init = init.expression;
    if (!t.isObjectExpression(init)) return null;
    return resolveObjectSpreads(init, getBinding)?.properties ?? null;
}

// ============================================================================
// CSS VARIABLE AUTO-COMPILE: Partial Object Evaluation
// ============================================================================

/** A runtime-valued sz prop compiled to a scoped CSS variable reference. */
interface DynamicPropInfo {
    expression: t.Expression;
    category: PropertyCategory;
    /** The sz key the value sits on — the runtime helper needs it for axis tokens. */
    szKey: string;
    varName: string;
    twPrefix: string;
    variantChain: string;
    skipClass?: boolean;
}

/** A conditional sz prop pre-lowered to its two compiled class branches. */
interface ConditionalClassEntry {
    test: t.Expression;
    consequent: string; // compiled Tailwind class(es) for truthy branch
    alternate: string; // compiled Tailwind class(es) for falsy branch
}

/** Partial evaluation of one sz object: static, dynamic, and conditional parts. */
interface PartialObjectResult {
    staticProps: SzObject;
    dynamicProps: Map<string, DynamicPropInfo>;
    rawClasses: string[];
    conditionalClasses: ConditionalClassEntry[];
    hasSpread: boolean;
    usesColorVar: boolean;
    usesSpacingVar: boolean;
    usesUnitVar: boolean;
}

/** A dynamic property plus the map key used for per-variant deduplication. */
interface DynamicPropRegistration {
    uniqueKey: string;
    info: DynamicPropInfo;
}

/**
 * Normalizes a Babel object-property key accepted by the sz object grammar.
 *
 * @param prop - Object property whose key should be read.
 * @returns The normalized string key, or null for unsupported key shapes.
 */
function getObjectPropertyKey(prop: t.ObjectProperty): string | null {
    if (t.isIdentifier(prop.key)) {
        return prop.key.name;
    }
    if (t.isStringLiteral(prop.key)) {
        return prop.key.value;
    }
    if (t.isNumericLiteral(prop.key)) {
        return String(prop.key.value);
    }
    return null;
}

/**
 * Builds the shared metadata for a runtime-valued sz property.
 *
 * @param key - Canonical sz key.
 * @param expression - Runtime value expression.
 * @param variantChain - Active nested variant path.
 * @returns The deduplication key and dynamic-property metadata.
 */
function createDynamicPropRegistration(
    key: string,
    expression: t.Expression,
    variantChain: string,
): DynamicPropRegistration {
    return {
        uniqueKey: variantChain ? `${variantChain}-${key}` : key,
        info: {
            expression,
            category: getPropertyCategory(key),
            szKey: key,
            varName: getCSSVariableName(key, variantChain || undefined),
            twPrefix: PROPERTY_MAP[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(),
            variantChain,
        },
    };
}

/**
 * Extracts a primitive literal value from an AST expression, or returns null if dynamic.
 * @param node - AST expression to extract from
 * @returns primitive value or null
 */
function extractStaticLiteralValue(node: t.Expression): string | number | boolean | null {
    if (t.isStringLiteral(node)) {
        return node.value;
    }
    if (t.isNumericLiteral(node)) {
        return node.value;
    }
    if (t.isBooleanLiteral(node)) {
        return node.value;
    }
    if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
        return -node.argument.value;
    }
    return null;
}

/**
 * Builds a className AST expression from a static base string and zero or more
 * conditional class entries (each ternary compiled to two static strings).
 *
 * Single conditional, no base → `cond ? 'a' : 'b'`
 * Otherwise → template literal: `base ${cond ? 'a' : 'b'} ${cond2 ? 'c' : 'd'}`
 * @param baseClasses - space-separated static Tailwind classes (may be empty)
 * @param conditionalClasses - ternary entries, each with a test expression and two compiled class strings
 * @returns Babel AST expression for the full className value
 */
function buildConditionalClassExpr(
    baseClasses: string,
    conditionalClasses: ConditionalClassEntry[],
): t.Expression {
    if (conditionalClasses.length === 0) {
        return t.stringLiteral(baseClasses);
    }

    // `bare` is true only for a top-level ternary used directly as the className
    // value (not interpolated). There, an empty branch becomes `undefined` so it
    // renders no class attribute. Inside a template literal (`base ${…}`) the
    // branch MUST stay an empty string — `${undefined}` would render the text
    // "undefined".
    const makeCondExpr = (cc: ConditionalClassEntry, bare: boolean): t.Expression =>
        t.conditionalExpression(
            cc.test,
            bare && cc.consequent === ''
                ? t.identifier('undefined')
                : t.stringLiteral(cc.consequent),
            bare && cc.alternate === '' ? t.identifier('undefined') : t.stringLiteral(cc.alternate),
        );

    // Simple case: single conditional, no static base → bare ternary, no template overhead
    if (conditionalClasses.length === 1 && !baseClasses) {
        return makeCondExpr(conditionalClasses[0], true);
    }

    // General case: template literal  `base ${c1} ${c2} …`
    const quasis: t.TemplateElement[] = [];
    const exprs: t.Expression[] = [];
    for (let i = 0; i < conditionalClasses.length; i++) {
        const prefix = i === 0 ? (baseClasses ? `${baseClasses} ` : '') : ' ';
        quasis.push(t.templateElement({ raw: prefix, cooked: prefix }, false));
        exprs.push(makeCondExpr(conditionalClasses[i], false));
    }
    quasis.push(t.templateElement({ raw: '', cooked: '' }, true));
    return t.templateLiteral(quasis, exprs);
}

/**
 * Evaluates an ObjectExpression with per-property static/dynamic analysis.
 * Static properties are compiled at build time; dynamic ones get CSS variable classes.
 *
 * @param node - The ObjectExpression AST node
 * @param variantChain - Current variant prefix chain (e.g., 'hover' for nested)
 * @returns Partial evaluation result, or null if has spread/computed keys
 */
function evaluatePartialObject(
    node: t.ObjectExpression,
    variantChain = '',
): PartialObjectResult | null {
    const result = createPartialObjectResult();
    for (const prop of node.properties) {
        if (!evaluatePartialProperty(prop, variantChain, result)) return null;
    }
    return result;
}

/**
 * Creates the neutral accumulator for partial sz object evaluation.
 * @returns Empty partial-object state
 */
function createPartialObjectResult(): PartialObjectResult {
    return {
        staticProps: {},
        dynamicProps: new Map<string, DynamicPropInfo>(),
        rawClasses: [],
        conditionalClasses: [],
        hasSpread: false,
        usesColorVar: false,
        usesSpacingVar: false,
        usesUnitVar: false,
    };
}

/**
 * Evaluates one property into an existing partial-object accumulator.
 * @param property - Object member to evaluate
 * @param variantChain - Active nested variant path
 * @param result - Partial-object state to update
 * @returns Whether the property can be represented by partial evaluation
 */
function evaluatePartialProperty(
    property: t.ObjectMethod | t.ObjectProperty | t.SpreadElement,
    variantChain: string,
    result: PartialObjectResult,
): boolean {
    if (!t.isObjectProperty(property) || property.computed) return false;
    const key = getObjectPropertyKey(property);
    if (key === null) return false;
    const value = property.value;
    const staticValue = extractStaticLiteralValue(t.isExpression(value) ? value : t.nullLiteral());
    if (staticValue !== null) {
        result.staticProps[key] = staticValue;
        return true;
    }
    if (t.isObjectExpression(value)) {
        return evaluatePartialObjectProperty(key, value, variantChain, result);
    }
    if (t.isConditionalExpression(value)) {
        evaluatePartialConditional(key, value, variantChain, result);
        return true;
    }
    if (!t.isExpression(value)) return false;
    registerPartialDynamicProp(key, value, variantChain, result);
    return true;
}

/**
 * Evaluates a nested static object, color object, or variant object.
 * @param key - Parent sz property key
 * @param value - Nested object value
 * @param variantChain - Active nested variant path
 * @param result - Partial-object state to update
 * @returns Whether the nested object has a supported representation
 */
function evaluatePartialObjectProperty(
    key: string,
    value: t.ObjectExpression,
    variantChain: string,
    result: PartialObjectResult,
): boolean {
    const nested = evaluateStaticObject(value);
    if (nested !== null) {
        result.staticProps[key] = nested;
        return true;
    }
    const properties = collectIdentifierObjectProperties(value);
    if (properties.has('color') && COLOR_PROPERTIES.has(key)) {
        evaluatePartialColorObject(key, properties, variantChain, result);
        return true;
    }
    if (!isKnownBabelVariant(key)) return false;
    return evaluatePartialVariant(key, value, variantChain, result);
}

/**
 * Indexes non-computed identifier properties for structured object handling.
 * @param node - Object expression to index
 * @returns Identifier-keyed object properties
 */
function collectIdentifierObjectProperties(
    node: t.ObjectExpression,
): Map<string, t.ObjectProperty> {
    const properties = new Map<string, t.ObjectProperty>();
    for (const property of node.properties) {
        if (t.isObjectProperty(property) && !property.computed && t.isIdentifier(property.key)) {
            properties.set(property.key.name, property);
        }
    }
    return properties;
}

/**
 * Evaluates supported static/dynamic color-object combinations.
 * @param key - Color sz property key
 * @param properties - Indexed color object members
 * @param variantChain - Active nested variant path
 * @param result - Partial-object state to update
 */
function evaluatePartialColorObject(
    key: string,
    properties: ReadonlyMap<string, t.ObjectProperty>,
    variantChain: string,
    result: PartialObjectResult,
): void {
    const colorProperty = properties.get('color');
    if (!colorProperty) return;
    const opacityProperty = properties.get('op');
    const color = t.isStringLiteral(colorProperty.value) ? colorProperty.value.value : null;
    if (color && opacityProperty) {
        evaluatePartialColorOpacity(key, color, opacityProperty, variantChain, result);
    } else if (!color && opacityProperty) {
        registerPartialDynamicColor(key, colorProperty, variantChain, result);
    } else if (color) {
        result.staticProps[key] = color as unknown as SzValue;
    }
}

/**
 * Evaluates the opacity half of a color object.
 * @param key - Color sz property key
 * @param color - Static color token
 * @param opacityProperty - Static or dynamic opacity member
 * @param variantChain - Active nested variant path
 * @param result - Partial-object state to update
 */
function evaluatePartialColorOpacity(
    key: string,
    color: string,
    opacityProperty: t.ObjectProperty,
    variantChain: string,
    result: PartialObjectResult,
): void {
    const opacity = opacityProperty.value;
    if (t.isStringLiteral(opacity) || t.isNumericLiteral(opacity)) {
        result.staticProps[key] = { color, op: opacity.value } as unknown as SzValue;
        return;
    }
    if (!t.isExpression(opacity)) return;
    const variable = getCSSVariableName(`${key}-op`, variantChain || undefined);
    const uniqueKey = variantChain ? `${variantChain}-${key}-op` : `${key}-op`;
    const prefix = PROPERTY_MAP[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    result.rawClasses.push(
        `${variantChain ? `${variantChain}:` : ''}${prefix}-${color}/(${variable})`,
    );
    result.dynamicProps.set(uniqueKey, {
        expression: opacity,
        category: PropertyCategory.UNITLESS,
        szKey: key,
        varName: variable,
        twPrefix: `${prefix}-op`,
        variantChain,
        skipClass: true,
    });
}

/**
 * Registers a fully dynamic color object.
 * @param key - Color sz property key
 * @param colorProperty - Dynamic color member
 * @param variantChain - Active nested variant path
 * @param result - Partial-object state to update
 */
function registerPartialDynamicColor(
    key: string,
    colorProperty: t.ObjectProperty,
    variantChain: string,
    result: PartialObjectResult,
): void {
    const expression = t.isExpression(colorProperty.value)
        ? colorProperty.value
        : t.stringLiteral('');
    const registration = createDynamicPropRegistration(key, expression, variantChain);
    result.usesColorVar = true;
    result.dynamicProps.set(registration.uniqueKey, {
        ...registration.info,
        category: PropertyCategory.COLOR,
    });
}

/**
 * Recursively evaluates and merges a dynamic nested variant.
 * @param key - Variant key to merge under
 * @param value - Nested variant object
 * @param variantChain - Parent variant path
 * @param result - Parent partial-object state
 * @returns Whether every nested member can be partially evaluated
 */
function evaluatePartialVariant(
    key: string,
    value: t.ObjectExpression,
    variantChain: string,
    result: PartialObjectResult,
): boolean {
    const variantKey = variantChain ? `${variantChain}-${key}` : key;
    const nested = evaluatePartialObject(value, variantKey);
    if (nested === null) return false;
    if (Object.keys(nested.staticProps).length > 0) result.staticProps[key] = nested.staticProps;
    for (const [nestedKey, info] of nested.dynamicProps) {
        result.dynamicProps.set(nestedKey, info);
    }
    result.rawClasses.push(...nested.rawClasses);
    result.conditionalClasses.push(...nested.conditionalClasses);
    result.usesColorVar ||= nested.usesColorVar;
    result.usesSpacingVar ||= nested.usesSpacingVar;
    result.usesUnitVar ||= nested.usesUnitVar;
    return true;
}

/**
 * Compiles a conditional property when both branches are static.
 * @param key - sz property key
 * @param value - Conditional property expression
 * @param variantChain - Active nested variant path
 * @param result - Partial-object state to update
 */
function evaluatePartialConditional(
    key: string,
    value: t.ConditionalExpression,
    variantChain: string,
    result: PartialObjectResult,
): void {
    if (evaluateNullablePartialConditional(key, value, variantChain, result)) return;
    const consequent = extractStaticLiteralValue(value.consequent);
    const alternate = extractStaticLiteralValue(value.alternate);
    if (consequent === null || alternate === null) {
        registerPartialDynamicProp(key, value, variantChain, result);
        return;
    }
    const classA = transform({ [key]: consequent }).className;
    const classB = transform({ [key]: alternate }).className;
    result.conditionalClasses.push({
        test: value.test,
        consequent: variantChain ? prefixClasses(classA, variantChain) : classA,
        alternate: variantChain ? prefixClasses(classB, variantChain) : classB,
    });
}

/**
 * Compiles conditionals whose nullish/falsy branch means that the property is absent.
 *
 * @param key sz property key.
 * @param value Conditional property expression.
 * @param variantChain Active nested variant path.
 * @param result Partial-object state to update.
 * @returns Whether an absent branch was handled.
 */
function evaluateNullablePartialConditional(
    key: string,
    value: t.ConditionalExpression,
    variantChain: string,
    result: PartialObjectResult,
): boolean {
    const consequentAbsent = isAbsentSzExpression(value.consequent);
    const alternateAbsent = isAbsentSzExpression(value.alternate);
    if (!consequentAbsent && !alternateAbsent) return false;
    if (consequentAbsent && alternateAbsent) {
        result.conditionalClasses.push({ test: value.test, consequent: '', alternate: '' });
        return true;
    }

    const presentNode = consequentAbsent ? value.alternate : value.consequent;
    const staticValue = extractStaticLiteralValue(presentNode);
    let presentClass: string;
    if (staticValue !== null) {
        presentClass = transform({ [key]: staticValue }).className;
        if (variantChain) presentClass = prefixClasses(presentClass, variantChain);
    } else {
        const info = registerPartialDynamicProp(key, value, variantChain, result);
        info.skipClass = true;
        presentClass = buildCSSVarClassName(info);
    }
    result.conditionalClasses.push({
        test: value.test,
        consequent: consequentAbsent ? '' : presentClass,
        alternate: alternateAbsent ? '' : presentClass,
    });
    return true;
}

/**
 * Returns whether an expression represents an omitted sz value while preserving numeric zero.
 *
 * @param expression Candidate conditional branch.
 * @returns Whether the branch should emit no class or CSS variable value.
 */
function isAbsentSzExpression(expression: t.Expression): boolean {
    const value = unwrapTsExpression(expression) ?? expression;
    return (
        t.isNullLiteral(value) ||
        (t.isIdentifier(value) && value.name === 'undefined') ||
        (t.isBooleanLiteral(value) && !value.value) ||
        (t.isStringLiteral(value) && value.value === '') ||
        (t.isUnaryExpression(value) && value.operator === 'void')
    );
}

/**
 * Registers a runtime-valued property and its required helper family.
 * @param key - sz property key
 * @param expression - Runtime value expression
 * @param variantChain - Active nested variant path
 * @param result - Partial-object state to update
 * @returns Registered dynamic-property metadata
 */
function registerPartialDynamicProp(
    key: string,
    expression: t.Expression,
    variantChain: string,
    result: PartialObjectResult,
): DynamicPropInfo {
    const registration = createDynamicPropRegistration(key, expression, variantChain);
    const { category } = registration.info;
    result.usesColorVar ||= COLOR_PROPERTIES.has(key);
    result.usesSpacingVar ||= category === PropertyCategory.SPACING;
    result.usesUnitVar ||=
        category === PropertyCategory.ANGLE || category === PropertyCategory.DURATION;
    result.dynamicProps.set(registration.uniqueKey, registration.info);
    return registration.info;
}

/**
 * Generates a CSS variable inline style value expression from a dynamic value.
 * Uses PropertyCategory to determine the right conversion.
 * @param info - the dynamic property info containing the expression and category
 * @returns a Babel expression node for the CSS variable inline style value
 */
function generateStyleValueExpression(info: DynamicPropInfo): t.Expression {
    const { expression, category } = info;

    switch (category) {
        case PropertyCategory.SPACING:
            return t.callExpression(t.identifier('__szSpacingVar'), [
                expression,
                t.stringLiteral(info.szKey),
            ]);

        case PropertyCategory.COLOR:
            return t.callExpression(t.identifier('__szColorVar'), [expression]);

        case PropertyCategory.ANGLE:
            return t.callExpression(t.identifier('__szUnitVar'), [
                expression,
                t.stringLiteral('deg'),
                t.stringLiteral(info.szKey),
            ]);

        case PropertyCategory.DURATION:
            return t.callExpression(t.identifier('__szUnitVar'), [
                expression,
                t.stringLiteral('ms'),
                t.stringLiteral(info.szKey),
            ]);
        default:
            return expression;
    }
}

/**
 * Recursively collects class names from a statically-resolved expression tree.
 * Only handles StringLiteral and ConditionalExpression — the only two node types
 * that tryStaticTransformNode can produce. Dynamic nodes (identifiers, calls) are
 * intentionally skipped since their class names are unknown at build time.
 *
 * @param node - resolved expression node (StringLiteral or ConditionalExpression)
 * @param classes - Set to collect into
 */
function collectFromExpr(node: t.Expression, classes: Set<string>): void {
    if (t.isStringLiteral(node)) {
        collectClassWords(node.value, classes);
        return;
    }
    if (t.isConditionalExpression(node)) {
        collectFromExpr(node.consequent as t.Expression, classes);
        collectFromExpr(node.alternate as t.Expression, classes);
        return;
    }
    if (t.isTemplateLiteral(node)) collectFromTemplateExpr(node, classes);
}

/**
 * Add whitespace-separated class candidates in source order.
 * @param value - Whitespace-separated class text.
 * @param classes - Candidate set to update.
 */
function collectClassWords(value: string, classes: Set<string>): void {
    for (const className of value.split(/\s+/)) {
        if (className) classes.add(className);
    }
}

/**
 * Collect interleaved static and conditional pieces from a template.
 * @param node - Template expression to traverse.
 * @param classes - Candidate set to update.
 */
function collectFromTemplateExpr(node: t.TemplateLiteral, classes: Set<string>): void {
    for (let index = 0; index < node.quasis.length; index++) {
        collectClassWords(node.quasis[index].value.cooked ?? '', classes);
        const expression = node.expressions[index];
        if (expression && t.isExpression(expression)) {
            collectFromExpr(expression, classes);
        }
    }
}

/**
 * Collect Tailwind candidate classes from any statically analysable expression.
 *
 * @param node Candidate expression (object, array, identifier, conditional, logical).
 * @param path Babel path used to resolve identifier bindings.
 * @param classes Output set collecting candidate classes for the catalog.
 */
function collectCandidatesFromBabelExpr(
    node: t.Expression,
    path: babel.NodePath,
    classes: Set<string>,
): void {
    if (
        t.isTSAsExpression(node) ||
        t.isTSSatisfiesExpression(node) ||
        t.isTSNonNullExpression(node) ||
        t.isTSInstantiationExpression(node)
    ) {
        collectCandidatesFromBabelExpr(node.expression as t.Expression, path, classes);
        return;
    }
    if (t.isArrayExpression(node)) {
        collectCandidatesFromBabelArray(node, path, classes);
    } else if (t.isObjectExpression(node)) {
        collectCandidatesFromBabelObj(node, path, classes, '');
    } else if (t.isIdentifier(node)) {
        collectCandidatesFromBabelIdentifier(node, path, classes);
    } else if (t.isConditionalExpression(node)) {
        collectCandidatesFromBabelExpr(node.consequent as t.Expression, path, classes);
        collectCandidatesFromBabelExpr(node.alternate as t.Expression, path, classes);
    } else if (t.isLogicalExpression(node) && node.operator === '&&') {
        collectCandidatesFromBabelExpr(node.right as t.Expression, path, classes);
    }
}

/**
 * Collect candidates from each non-spread array element.
 * @param node - Array expression to traverse.
 * @param path - Babel path used for binding lookup.
 * @param classes - Candidate set to populate.
 */
function collectCandidatesFromBabelArray(
    node: t.ArrayExpression,
    path: babel.NodePath,
    classes: Set<string>,
): void {
    for (const element of node.elements) {
        if (element === null || t.isSpreadElement(element)) continue;
        const candidate =
            t.isLogicalExpression(element) && element.operator === '&&'
                ? (element.right as t.Expression)
                : (element as t.Expression);
        collectCandidatesFromBabelExpr(candidate, path, classes);
    }
}

/**
 * Resolve a bound identifier and collect from its initializer.
 * @param node - Identifier to resolve.
 * @param path - Babel path used for binding lookup.
 * @param classes - Candidate set to populate.
 */
function collectCandidatesFromBabelIdentifier(
    node: t.Identifier,
    path: babel.NodePath,
    classes: Set<string>,
): void {
    const binding = path.scope.getBinding(node.name);
    if (!binding?.path.isVariableDeclarator()) return;
    let initializer = binding.path.node.init;
    if (!initializer) return;
    while (t.isTSAsExpression(initializer) || t.isTSSatisfiesExpression(initializer)) {
        initializer = initializer.expression;
    }
    collectCandidatesFromBabelExpr(initializer as t.Expression, path, classes);
}

/**
 * Collect candidate classes from one object expression, including variant nests.
 *
 * @param node Object expression to compile for candidates.
 * @param path Babel path used to resolve identifier bindings.
 * @param classes Output set collecting candidate classes for the catalog.
 * @param variantPrefix Variant chain to prefix onto collected classes.
 */
function collectCandidatesFromBabelObj(
    node: t.ObjectExpression,
    path: babel.NodePath,
    classes: Set<string>,
    variantPrefix: string,
): void {
    const context: BabelCandidateContext = { path, classes, variantPrefix };
    for (const property of node.properties) {
        if (t.isSpreadElement(property)) collectBabelCandidateSpread(property, context);
        else if (t.isObjectProperty(property)) collectBabelCandidateProperty(property, context);
    }
}

/** Shared state for Babel candidate collection. */
interface BabelCandidateContext {
    path: babel.NodePath;
    classes: Set<string>;
    variantPrefix: string;
}

/**
 * Collects a spread from a bound object or dynamic expression.
 *
 * @param spread Spread element.
 * @param context Candidate collection state.
 */
function collectBabelCandidateSpread(
    spread: t.SpreadElement,
    context: BabelCandidateContext,
): void {
    const argument = spread.argument;
    const boundObject = t.isIdentifier(argument)
        ? resolveBoundBabelObject(argument, context.path)
        : null;
    if (boundObject) {
        collectCandidatesFromBabelObj(
            boundObject,
            context.path,
            context.classes,
            context.variantPrefix,
        );
        return;
    }
    collectCandidatesFromBabelExpr(argument as t.Expression, context.path, context.classes);
}

/**
 * Resolves an identifier binding to an unwrapped object initializer.
 *
 * @param identifier Bound identifier.
 * @param path Babel path used for binding lookup.
 * @returns Object initializer, or null when dynamic.
 */
function resolveBoundBabelObject(
    identifier: t.Identifier,
    path: babel.NodePath,
): t.ObjectExpression | null {
    const binding = path.scope.getBinding(identifier.name);
    if (!binding?.path.isVariableDeclarator()) return null;
    const initializer = unwrapTsExpression(binding.path.node.init);
    return t.isObjectExpression(initializer) ? initializer : null;
}

/**
 * Collects candidates from one static-key Babel property.
 *
 * @param property Object property.
 * @param context Candidate collection state.
 */
function collectBabelCandidateProperty(
    property: t.ObjectProperty,
    context: BabelCandidateContext,
): void {
    const key = getObjectPropertyKey(property);
    if (key === null || !t.isExpression(property.value)) return;
    const value = property.value;
    if (t.isObjectExpression(value)) {
        collectBabelObjectProperty(key, value, context);
    } else if (t.isConditionalExpression(value)) {
        collectBabelConditionalProperty(key, value, context);
    } else {
        collectBabelValueProperty(key, value, context);
    }
}

/**
 * Collects an object-valued property with nested variant support.
 *
 * @param key Property key.
 * @param value Object value.
 * @param context Candidate collection state.
 */
function collectBabelObjectProperty(
    key: string,
    value: t.ObjectExpression,
    context: BabelCandidateContext,
): void {
    if (isKnownBabelVariant(key)) {
        const variantPrefix = context.variantPrefix ? `${context.variantPrefix}:${key}` : key;
        collectCandidatesFromBabelObj(value, context.path, context.classes, variantPrefix);
        return;
    }
    const getBinding = (name: string): ReturnType<typeof context.path.scope.getBinding> =>
        context.path.scope.getBinding(name);
    const flattened = resolveObjectSpreads(value, getBinding) ?? value;
    if (!tryCollectStaticBabelProperty(key, flattened, context)) {
        collectCandidatesFromBabelExpr(value, context.path, context.classes);
    }
}

/**
 * Collects both branches of a conditional property.
 *
 * @param key Property key.
 * @param conditional Conditional value.
 * @param context Candidate collection state.
 */
function collectBabelConditionalProperty(
    key: string,
    conditional: t.ConditionalExpression,
    context: BabelCandidateContext,
): void {
    collectBabelValueProperty(key, conditional.consequent, context);
    collectBabelValueProperty(key, conditional.alternate, context);
}

/**
 * Compiles a finite property value or falls back to expression discovery.
 *
 * @param key Property key.
 * @param value Property value.
 * @param context Candidate collection state.
 */
function collectBabelValueProperty(
    key: string,
    value: t.Expression,
    context: BabelCandidateContext,
): void {
    if (!tryCollectStaticBabelProperty(key, value, context)) {
        collectCandidatesFromBabelExpr(value, context.path, context.classes);
    }
}

/**
 * Attempts to compile one static Babel property value.
 *
 * @param key Property key.
 * @param value Property value.
 * @param context Candidate collection state.
 * @returns Whether static compilation succeeded.
 */
function tryCollectStaticBabelProperty(
    key: string,
    value: t.Expression,
    context: BabelCandidateContext,
): boolean {
    if (!isBabelCandidateLiteral(value)) return false;
    const object = evaluateStaticObject(
        t.objectExpression([t.objectProperty(t.identifier(key), value)]),
    );
    if (object === null) return false;
    const result = transform(object);
    const className = context.variantPrefix
        ? prefixClasses(result.className, context.variantPrefix)
        : result.className;
    addClassTokens(className, context.classes);
    return true;
}

/**
 * Returns whether a Babel value shape can be evaluated for candidate discovery.
 *
 * @param value Property value.
 * @returns Whether static evaluation should be attempted.
 */
function isBabelCandidateLiteral(value: t.Expression): boolean {
    return (
        t.isStringLiteral(value) ||
        t.isNumericLiteral(value) ||
        t.isBooleanLiteral(value) ||
        t.isObjectExpression(value)
    );
}

/**
 * Prefix every class in a space-separated list with a variant chain.
 *
 * @param classesStr Space-separated class list.
 * @param variantChain Variant chain key (camelCase or kebab-case).
 * @returns The list with each class prefixed, e.g. `hover:p-4`.
 */
function prefixClasses(classesStr: string, variantChain: string): string {
    const variantPrefix = getVariantPrefix(variantChain);
    return classesStr
        .split(/\s+/)
        .map(c => (c ? `${variantPrefix}:${c}` : ''))
        .join(' ');
}

/**
 * Check whether a property key is a known variant container.
 *
 * @param key sz object key.
 * @returns True for known variants.
 */
function isKnownBabelVariant(key: string): boolean {
    return KNOWN_VARIANTS.has(key) || KNOWN_VARIANTS.has(getVariantPrefix(key));
}

/**
 * Builds the CSS variable class name for a dynamic property.
 * e.g., p -> "p-(--_sz-p)", hover:bg -> "hover:bg-(--_sz-hover-bg)"
 * Uses Tailwind v4 CSS variable shorthand (--var) instead of [var(--var)].
 * @param info - the dynamic property info containing prefix, var name, and variant chain
 * @returns the CSS class name string using a CSS variable reference
 */
function buildCSSVarClassName(info: DynamicPropInfo): string {
    const { twPrefix, varName, variantChain } = info;
    const variantPrefix = variantChain ? `${getVariantPrefix(variantChain)}:` : '';
    return `${variantPrefix}${twPrefix}-(${varName})`;
}
