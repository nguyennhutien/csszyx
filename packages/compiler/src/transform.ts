
import * as babel from '@babel/core';
import * as t from '@babel/types';

import { AST_BUDGET, ASTBudgetExceededError } from './ast-budget.js';
import { COLOR_PROPERTIES, getCSSVariableName, getPropertyCategory, PropertyCategory } from './property-types.js';
import { generateRecoveryToken, isValidRecoveryMode, type RecoveryTokenData } from './recovery-tokens.js';
import {
    getVariantPrefix,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    SzObject,
    SzValue,
    transform } from './transform-core.js';

// Re-export everything from core so consumers don't break
export { AST_BUDGET, ASTBudgetExceededError } from './ast-budget.js';
export { generateRecoveryToken, isValidRecoveryMode, type RecoveryMode, type RecoveryTokenData } from './recovery-tokens.js';
export * from './transform-core.js';

/**
 * Transforms all sz props in a source code string into Tailwind classNames.
 *
 * @param {string} source - The source code to transform
 * @param {string} [filename] - Source filename, used in error messages and
 *   passed to Babel as the parser filename. Defaults to a placeholder.
 * @returns {object} Transformation result with code and metadata
 * @throws {ASTBudgetExceededError} when the file's AST exceeds AST_BUDGET nodes.
 */
export function transformSourceCode(source: string, filename?: string): { code: string; transformed: boolean; usesRuntime: boolean; usesMerge: boolean; usesColorVar: boolean; classes: Set<string>; rawClassNames: Set<string>; diagnostics: string[]; recoveryTokens: Map<string, RecoveryTokenData> } {
    let usesRuntime = false;
    let usesMerge = false;
    let usesColorVar = false;
    let transformed = false;
    const collectedClasses = new Set<string>();
    // Raw class names from className="..." attributes — used for TW JIT safelist only, NOT for mangling.
    const rawClassNames = new Set<string>();
    // Dev-mode diagnostics: emitted when sz props fall back to runtime transforms.
    const diagnostics: string[] = [];
    // Recovery tokens collected from szRecover attributes in this file. Keyed
    // by token (12-char hex hash); the unplugin aggregates these across all
    // files and serializes the result into the manifest script tag.
    const recoveryTokens = new Map<string, RecoveryTokenData>();

    // Fast path: check if file contains 'sz' before parsing
    if (!source.includes('sz')) {
        return { code: source, transformed: false, usesRuntime: false, usesMerge: false, usesColorVar: false, classes: collectedClasses, rawClassNames, diagnostics, recoveryTokens };
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
                function() {
                    return {
                        // Budget guard runs in `pre` (before the visitor pass)
                        // so it short-circuits pathologically large files
                        // before any sz transform work begins, and doesn't
                        // interfere with the JSXAttribute handler below.
                        pre(file: { ast: t.File }) {
                            let nodeCount = 0;
                            babel.traverse(file.ast, {
                                enter() {
                                    nodeCount++;
                                    if (nodeCount > AST_BUDGET) {
                                        throw new ASTBudgetExceededError(filename, nodeCount);
                                    }
                                },
                            });
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
                                    const val = path.node.value;
                                    if (t.isStringLiteral(val)) {
                                        for (const c of val.value.split(/\s+/)) {
                                            if (c) {rawClassNames.add(c);}
                                        }
                                    }
                                    return;
                                }

                                // szRecover handling: emit a recovery token + data-sz-recovery-token
                                // attribute so the runtime can match it against the manifest. Only
                                // string-literal modes (`csr` / `dev-only`) are processed; expression
                                // values (`szRecover={mode}`) are left untouched and warned about.
                                if (attrName === 'szRecover') {
                                    const recoverValue = path.node.value;
                                    if (!t.isStringLiteral(recoverValue)) {
                                        diagnostics.push(
                                            `[csszyx] szRecover at ${filename ?? '<anonymous>'}: ` +
                                            'only string-literal values ("csr" | "dev-only") are supported. ' +
                                            'Dynamic values disable token emission for this element.',
                                        );
                                        return;
                                    }
                                    if (!isValidRecoveryMode(recoverValue.value)) {
                                        diagnostics.push(
                                            `[csszyx] szRecover at ${filename ?? '<anonymous>'}: ` +
                                            `unknown mode "${recoverValue.value}" — expected "csr" or "dev-only". ` +
                                            'Token emission skipped.',
                                        );
                                        return;
                                    }

                                    const opening = path.parentPath;
                                    if (!opening?.isJSXOpeningElement()) {return;}
                                    // Skip if a token is already attached (idempotent on re-visits, e.g. HMR).
                                    const alreadyTagged = opening.node.attributes.some(attr =>
                                        t.isJSXAttribute(attr)
                                        && t.isJSXIdentifier(attr.name)
                                        && attr.name.name === 'data-sz-recovery-token',
                                    );
                                    if (alreadyTagged) {return;}

                                    const loc = path.node.loc;
                                    const elementType = t.isJSXIdentifier(opening.node.name)
                                        ? opening.node.name.name
                                        : t.isJSXMemberExpression(opening.node.name)
                                            ? '<member>'
                                            : '<unknown>';
                                    const line = loc?.start.line ?? 0;
                                    const column = loc?.start.column ?? 0;
                                    const file = filename ?? 'file.tsx';
                                    const token = generateRecoveryToken(file, line, column, elementType);

                                    opening.node.attributes.push(
                                        t.jsxAttribute(
                                            t.jsxIdentifier('data-sz-recovery-token'),
                                            t.stringLiteral(token),
                                        ),
                                    );
                                    recoveryTokens.set(token, {
                                        mode: recoverValue.value,
                                        component: elementType,
                                        path: `${file}:${line}:${column}`,
                                    });
                                    transformed = true;
                                    return;
                                }

                                if (attrName !== 'sz') {return;}

                                const value = path.node.value;

                                // Piggyback: Check if there's an existing className or style to merge
                                let existingClassNameNode: t.JSXAttribute | null = null;
                                let existingClassExpr: t.Expression | null = null;
                                let existingStyleNode: t.JSXAttribute | null = null;
                                let existingStyleExpr: t.Expression | null = null;

                                if (path.parentPath?.isJSXOpeningElement()) {
                                    for (const attr of path.parentPath.node.attributes) {
                                        if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
                                            const aName = attr.name;
                                            if (aName.name === 'className' || aName.name === 'class') {
                                                existingClassNameNode = attr;
                                                const aVal = attr.value;
                                                if (t.isStringLiteral(aVal)) {
                                                    existingClassExpr = aVal;
                                                } else if (t.isJSXExpressionContainer(aVal)) {
                                                    if (t.isExpression(aVal.expression)) {
                                                        existingClassExpr = aVal.expression;
                                                    }
                                                }
                                            } else if (aName.name === 'style') {
                                                existingStyleNode = attr;
                                                const aVal = attr.value;
                                                if (t.isJSXExpressionContainer(aVal)) {
                                                    if (t.isExpression(aVal.expression)) {
                                                        existingStyleExpr = aVal.expression;
                                                    }
                                                } else if (t.isStringLiteral(aVal)) {
                                                    existingStyleExpr = aVal;
                                                }
                                            }
                                        }
                                    }
                                }

                                const createMergedClassNameValue = (szExpr: t.Expression): t.StringLiteral | t.JSXExpressionContainer => {
                                    if (!existingClassExpr) {
                                        return t.isStringLiteral(szExpr) ? szExpr : t.jsxExpressionContainer(szExpr);
                                    }

                                    // Remove the old className attribute so we don't duplicate
                                    if (existingClassNameNode && path.parentPath?.isJSXOpeningElement()) {
                                        path.parentPath.node.attributes = path.parentPath.node.attributes.filter(
                                            a => a !== existingClassNameNode,
                                        );
                                        existingClassNameNode = null;
                                    }

                                    // Both are strings: static merge
                                    if (t.isStringLiteral(existingClassExpr) && t.isStringLiteral(szExpr)) {
                                        const merged = `${existingClassExpr.value} ${szExpr.value}`.trim();
                                        return t.stringLiteral(merged);
                                    }

                                    // Runtime merge using _szMerge(existing, sz)
                                    usesRuntime = true;
                                    usesMerge = true;
                                    return t.jsxExpressionContainer(
                                        t.callExpression(t.identifier('_szMerge'), [existingClassExpr, szExpr]),
                                    );
                                };

                                const mergeAndInjectStyle = (newStyleProps: t.ObjectProperty[]): void => {
                                    if (newStyleProps.length === 0) {return;}
                                    if (!path.parentPath?.isJSXOpeningElement()) {return;}

                                    if (existingStyleNode && existingStyleExpr) {
                                        path.parentPath.node.attributes = path.parentPath.node.attributes.filter(
                                            a => a !== existingStyleNode,
                                        );
                                        existingStyleNode = null; // Prevent re-filtering

                                        if (t.isObjectExpression(existingStyleExpr)) {
                                            existingStyleExpr.properties.push(...newStyleProps);
                                            path.parentPath.node.attributes.push(
                                                t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(existingStyleExpr)),
                                            );
                                        } else if (t.isStringLiteral(existingStyleExpr)) {
                                            // existing style is a string. parse it.
                                            const parsedOldProps = parseStyleStringToObjectExpr(existingStyleExpr.value).properties;
                                            path.parentPath.node.attributes.push(
                                                t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(
                                                    t.objectExpression([...parsedOldProps, ...newStyleProps]),
                                                )),
                                            );
                                        } else {
                                            // It's a dynamic reference like style={myStyles}
                                            const mergedStyle = t.objectExpression([
                                                t.spreadElement(existingStyleExpr),
                                                ...newStyleProps,
                                            ]);
                                            path.parentPath.node.attributes.push(
                                                t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(mergedStyle)),
                                            );
                                        }
                                    } else {
                                        path.parentPath.node.attributes.push(
                                            t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(t.objectExpression(newStyleProps))),
                                        );
                                        // Update so future calls inside the same element use it
                                        existingStyleExpr = t.objectExpression(newStyleProps);
                                        existingStyleNode = path.parentPath.node.attributes[path.parentPath.node.attributes.length - 1] as t.JSXAttribute;
                                    }
                                };

                                // Case 1: sz="string"
                                if (t.isStringLiteral(value)) {
                                    path.node.name.name = 'className';
                                    for (const c of value.value.split(/\s+/)) {
                                        if (c) {collectedClasses.add(c);}
                                    }
                                    path.node.value = createMergedClassNameValue(value);
                                    transformed = true;
                                    return;
                                }

                                // Case 2: sz={...}
                                if (t.isJSXExpressionContainer(value)) {
                                    const expression = value.expression;

                                    // Static Extraction Logic: sz={{ p: 4, bg: 'blue' }}
                                    if (t.isObjectExpression(expression)) {
                                        // Flatten SpreadElements from local variable bindings before
                                        // static/partial evaluation. Falls back to original expression
                                        // if any spread can't be statically resolved.
                                        const getBinding = (name: string): ReturnType<typeof path.scope.getBinding> => path.scope.getBinding(name);
                                        const flatExpression = resolveObjectSpreads(expression, getBinding) ?? expression;

                                        const staticObject = evaluateStaticObject(flatExpression);
                                        if (staticObject !== null) {
                                            // Compile time transformation
                                            const { className, attributes } = transform(staticObject);
                                            for (const c of className.split(/\s+/)) {
                                                if (c) {collectedClasses.add(c);}
                                            }
                                            path.node.name.name = 'className';
                                            path.node.value = createMergedClassNameValue(t.stringLiteral(className));

                                            // Inject attributes (will-change)
                                            Object.entries(attributes).forEach(([key, val]) => {
                                                if (path.parentPath?.isJSXOpeningElement()) {
                                                    if (key === 'style') {
                                                        const newProps = parseStyleStringToObjectExpr(val).properties;
                                                        mergeAndInjectStyle(newProps as t.ObjectProperty[]);
                                                    } else {
                                                        path.parentPath.node.attributes.push(
                                                            t.jsxAttribute(
                                                                t.jsxIdentifier(key),
                                                                t.stringLiteral(val),
                                                            ),
                                                        );
                                                    }
                                                }
                                            });

                                            transformed = true;
                                            return;
                                        }

                                        // Hoist conditional spread: { ...(cond ? varA : varB), key: 'val' }
                                        // → className={cond ? "classes-a key-val" : "classes-b key-val"}
                                        const hoisted = tryHoistConditionalSpread(expression, getBinding);
                                        if (hoisted !== null) {
                                            path.node.name.name = 'className';
                                            path.node.value = createMergedClassNameValue(hoisted);
                                            collectFromExpr(hoisted, collectedClasses);
                                            transformed = true;
                                            return;
                                        }

                                        // CSS Variable Auto-Compile: partial static/dynamic
                                        const partial = evaluatePartialObject(flatExpression);
                                        if (partial !== null && !partial.hasSpread &&
                                            (partial.dynamicProps.size > 0 || partial.conditionalClasses.length > 0)) {
                                            // Build static class string from static props
                                            const staticClasses: string[] = [];
                                            if (Object.keys(partial.staticProps).length > 0) {
                                                const { className: sc } = transform(partial.staticProps);
                                                if (sc) {staticClasses.push(sc);}
                                            }

                                            // Build CSS variable class strings (truly dynamic props)
                                            const cssVarClasses: string[] = [];
                                            const styleProps: t.ObjectProperty[] = [];

                                            for (const [, info] of partial.dynamicProps) {
                                                if (!info.skipClass) {
                                                    cssVarClasses.push(buildCSSVarClassName(info));
                                                }
                                                styleProps.push(
                                                    t.objectProperty(
                                                        t.stringLiteral(info.varName),
                                                        generateStyleValueExpression(info),
                                                    ),
                                                );
                                            }

                                            // Collect all classes for Tailwind safelist
                                            const baseClasses = [...staticClasses, ...partial.rawClasses, ...cssVarClasses].join(' ');
                                            for (const c of baseClasses.split(/\s+/)) {
                                                if (c) {collectedClasses.add(c);}
                                            }
                                            for (const cc of partial.conditionalClasses) {
                                                for (const c of cc.consequent.split(/\s+/)) { if (c) {collectedClasses.add(c);} }
                                                for (const c of cc.alternate.split(/\s+/)) { if (c) {collectedClasses.add(c);} }
                                            }

                                            // Build className expression
                                            // - no conditionals: plain string (same as before)
                                            // - has conditionals: template literal or bare ternary
                                            const classExpr = partial.conditionalClasses.length > 0
                                                ? buildConditionalClassExpr(baseClasses, partial.conditionalClasses)
                                                : t.stringLiteral(baseClasses);

                                            // Set className
                                            path.node.name.name = 'className';
                                            path.node.value = createMergedClassNameValue(classExpr);

                                            // Inject style attribute (only when CSS variables are needed)
                                            mergeAndInjectStyle(styleProps);

                                            // Track __szColorVar usage
                                            if (partial.usesColorVar) {
                                                usesColorVar = true;
                                            }

                                            transformed = true;
                                            return;
                                        }
                                    }

                                    // Identifier resolution: sz={mySzVar}
                                    // Resolve variable binding and try to pre-compile
                                    if (t.isIdentifier(expression) && !t.isJSXEmptyExpression(expression)) {
                                        const binding = path.scope.getBinding(expression.name);
                                        if (binding && binding.path.isVariableDeclarator()) {
                                            const init = binding.path.node.init;
                                            if (init) {
                                                const gbIdent = (name: string): ReturnType<typeof path.scope.getBinding> => path.scope.getBinding(name);
                                                const resolved = tryStaticTransformNode(init, gbIdent);
                                                if (resolved !== null) {
                                                    path.node.name.name = 'className';
                                                    if (t.isStringLiteral(resolved)) {
                                                        path.node.value = createMergedClassNameValue(resolved);
                                                        for (const c of resolved.value.split(/\s+/)) {
                                                            if (c) {collectedClasses.add(c);}
                                                        }
                                                    } else {
                                                        path.node.value = createMergedClassNameValue(resolved);
                                                        collectFromExpr(resolved, collectedClasses);
                                                    }
                                                    transformed = true;
                                                    return;
                                                }
                                            }
                                        }
                                    }

                                    // Conditional expression: sz={cond ? {...} : {...}}
                                    if (t.isConditionalExpression(expression)) {
                                        const gbCond = (name: string): ReturnType<typeof path.scope.getBinding> => path.scope.getBinding(name);
                                        const resolved = tryStaticTransformNode(expression, gbCond);
                                        if (resolved !== null) {
                                            path.node.name.name = 'className';
                                            if (t.isStringLiteral(resolved)) {
                                                path.node.value = createMergedClassNameValue(resolved);
                                                for (const c of resolved.value.split(/\s+/)) {
                                                    if (c) {collectedClasses.add(c);}
                                                }
                                            } else {
                                                path.node.value = createMergedClassNameValue(resolved);
                                                collectFromExpr(resolved, collectedClasses);
                                            }
                                            transformed = true;
                                            return;
                                        }
                                    }

                                    // Array expression: sz={[obj1, cond && obj2, ...]}
                                    if (t.isArrayExpression(expression)) {
                                        const parts: t.Expression[] = [];
                                        let hasRuntime = false;
                                        const getBindingForArray = (name: string): ReturnType<typeof path.scope.getBinding> => path.scope.getBinding(name);

                                        for (const element of expression.elements) {
                                            // Sparse hole, false, null → skip
                                            if (element === null) {continue;}
                                            if (t.isBooleanLiteral(element) && !element.value) {continue;}
                                            if (t.isNullLiteral(element)) {continue;}
                                            if (t.isIdentifier(element) && element.name === 'undefined') {continue;}

                                            // condition && szObject → keep condition, compile right to string
                                            if (t.isLogicalExpression(element) && element.operator === '&&') {
                                                const resolved = tryStaticTransformNode(element.right, getBindingForArray);
                                                if (resolved !== null && t.isStringLiteral(resolved)) {
                                                    if (resolved.value) {
                                                        parts.push(t.logicalExpression('&&', element.left, resolved));
                                                        for (const c of resolved.value.split(/\s+/)) {
                                                            if (c) {collectedClasses.add(c);}
                                                        }
                                                        hasRuntime = true;
                                                    }
                                                    // empty compiled string: skip element
                                                    continue;
                                                }
                                                // dynamic right side: pass through
                                                parts.push(element as t.Expression);
                                                hasRuntime = true;
                                                continue;
                                            }

                                            // Any other node: try static compile
                                            const resolved = tryStaticTransformNode(element as t.Node, getBindingForArray);
                                            if (resolved !== null) {
                                                if (t.isStringLiteral(resolved)) {
                                                    if (resolved.value) {
                                                        parts.push(resolved);
                                                        for (const c of resolved.value.split(/\s+/)) {
                                                            if (c) {collectedClasses.add(c);}
                                                        }
                                                    }
                                                } else {
                                                    parts.push(resolved);
                                                    collectFromExpr(resolved, collectedClasses);
                                                    hasRuntime = true;
                                                }
                                            } else {
                                                parts.push(element as t.Expression);
                                                hasRuntime = true;
                                            }
                                        }

                                        path.node.name.name = 'className';

                                        if (parts.length === 0) {
                                            path.node.value = createMergedClassNameValue(t.stringLiteral(''));
                                        } else if (!hasRuntime) {
                                            // All static → single merged className string, zero runtime
                                            const merged = (parts as t.StringLiteral[])
                                                .map(p => p.value)
                                                .filter(Boolean)
                                                .join(' ');
                                            path.node.value = createMergedClassNameValue(t.stringLiteral(merged));
                                        } else {
                                            if (existingClassExpr) {
                                                parts.unshift(existingClassExpr);
                                                if (existingClassNameNode && path.parentPath?.isJSXOpeningElement()) {
                                                    path.parentPath.node.attributes = path.parentPath.node.attributes.filter(
                                                        a => a !== existingClassNameNode,
                                                    );
                                                    existingClassNameNode = null;
                                                }
                                            }
                                            // _szMerge handles falsy + dedup at runtime
                                            const szCall = t.callExpression(
                                                t.identifier('_szMerge'),
                                                parts,
                                            );
                                            path.node.value = t.jsxExpressionContainer(szCall);
                                            usesMerge = true;
                                            usesRuntime = true;
                                        }

                                        transformed = true;
                                        return;
                                    }

                                    // Fallback: Runtime wrapper
                                    // Emit a dev-mode diagnostic so developers know why the fallback
                                    // happened and which alternative pattern to use instead.
                                    const loc = (expression as t.Expression).loc;
                                    const lineCol = loc ? `${loc.start.line}:${loc.start.column + 1}` : '?';
                                    let reason: string,
                                        suggestion: string;
                                    if (t.isCallExpression(expression)) {
                                        const callee = expression.callee;
                                        const name = t.isIdentifier(callee) ? callee.name
                                            : t.isMemberExpression(callee) && t.isIdentifier(callee.property)
                                                ? callee.property.name : '?';
                                        reason = `function call \`${name}()\` result is unknown at build time`;
                                        suggestion = 'If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic().';
                                    } else if (t.isIdentifier(expression)) {
                                        reason = `identifier \`${expression.name}\` could not be resolved to a static value`;
                                        suggestion = 'Make sure it\'s a module-level or function-body const with a literal object value. For variant-based styling → szv(). For true runtime values → dynamic().';
                                    } else if (t.isMemberExpression(expression)) {
                                        reason = 'member expression is not statically resolvable';
                                        suggestion = 'Extract the value to a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().';
                                    } else {
                                        reason = `expression of type \`${(expression as t.Expression).type}\` is not statically analyzable`;
                                        suggestion = 'Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().';
                                    }
                                    diagnostics.push(`sz fallback at ${lineCol}: ${reason}.\n  Suggestion: ${suggestion}`);

                                    path.node.name.name = 'className';
                                    const szCall = t.callExpression(
                                        t.identifier('_sz'),
                                        [expression as t.Expression],
                                    );
                                    path.node.value = createMergedClassNameValue(szCall);
                                    usesRuntime = true;
                                    transformed = true;
                                }
                            },

                            // ── szv catalog extraction ────────────────────────────────────────
                            // When the compiler sees `const X = szv({...})` with a static config,
                            // it emits a no-op catalog array so Tailwind JIT can scan all variant
                            // class strings — even when szv is called at runtime with dynamic args.
                            VariableDeclarator(path: babel.NodePath<t.VariableDeclarator>) {
                                const init = path.node.init;
                                if (!t.isCallExpression(init)) {return;}
                                if (!t.isIdentifier(init.callee) || init.callee.name !== 'szv') {return;}
                                if (init.arguments.length === 0) {return;}
                                if (!t.isIdentifier(path.node.id)) {return;}

                                const configArg = init.arguments[0];
                                if (!t.isObjectExpression(configArg)) {return;}
                                const config = evaluateStaticObject(configArg);
                                if (!config) {return;}

                                const base = (config.base ?? {}) as SzObject;
                                const variants = (config.variants ?? {}) as Record<string, Record<string, SzObject>>;

                                const classStrings: string[] = [];

                                // Emit the base styles alone (covers defaultVariants case)
                                const baseResult = transform(base);
                                const baseCls = typeof baseResult === 'string' ? baseResult : baseResult.className;
                                if (baseCls) {classStrings.push(baseCls);}

                                // Emit base merged with each variant value — per-dimension, not
                                // cross-product. Covers all unique classes in O(total variant values).
                                for (const variantValues of Object.values(variants)) {
                                    for (const variantObj of Object.values(variantValues)) {
                                        if (!variantObj || typeof variantObj !== 'object') {continue;}
                                        const merged: SzObject = { ...base, ...(variantObj as SzObject) };
                                        const result = transform(merged);
                                        const cls = typeof result === 'string' ? result : result.className;
                                        if (cls) {classStrings.push(cls);}
                                    }
                                }

                                if (classStrings.length === 0) {return;}

                                // Feed individual tokens into collectedClasses so that
                                // prescanAndWriteClasses() includes them in csszyx-classes.html
                                // → Tailwind JIT scans the file and generates CSS for all variants.
                                for (const combined of classStrings) {
                                    for (const c of combined.split(/\s+/)) {
                                        if (c) {collectedClasses.add(c);}
                                    }
                                }

                                // const _szv_catalog_X = ["flex flex-col ...", "flex flex-row ..."]
                                const catalogDecl = t.variableDeclaration('const', [
                                    t.variableDeclarator(
                                        t.identifier(`_szv_catalog_${path.node.id.name}`),
                                        t.arrayExpression(classStrings.map(s => t.stringLiteral(s))),
                                    ),
                                ]);

                                const parentPath = path.parentPath;
                                if (parentPath && t.isVariableDeclaration(parentPath.node)) {
                                    (parentPath as babel.NodePath<t.VariableDeclaration>).insertAfter(catalogDecl);
                                    transformed = true;
                                }
                            },

                            // ── dynamic() literal extraction ──────────────────────────────────
                            // Detects `dynamic({...})` and `dynamic(CONST_IDENTIFIER)` calls
                            // with statically-analyzable arguments and adds the resulting
                            // class tokens to collectedClasses so prescanAndWriteClasses()
                            // includes them in csszyx-classes.html for Tailwind to scan.
                            // This means dynamic() with static/const args works in Astro SSR
                            // without needing client:* directives.
                            CallExpression(path: babel.NodePath<t.CallExpression>) {
                                const callee = path.node.callee;
                                if (!t.isIdentifier(callee) || callee.name !== 'dynamic') {return;}
                                if (path.node.arguments.length === 0) {return;}

                                const arg = path.node.arguments[0];

                                // Case 1: dynamic({ key: value, ... }) — inline literal object
                                if (t.isObjectExpression(arg)) {
                                    const staticObj = evaluateStaticObject(arg);
                                    if (!staticObj) {return;}
                                    const { className } = transform(staticObj as SzObject);
                                    for (const c of className.split(/\s+/)) {
                                        if (c) {collectedClasses.add(c);}
                                    }
                                    return;
                                }

                                // Case 2: dynamic(IDENTIFIER) — module-level const reference
                                // Also handles `dynamic(CONST as any)` / `dynamic(CONST as T)` —
                                // unwrap TSAs/TSSatisfies wrappers on the argument itself before
                                // checking for an Identifier (the inner expression is the const ref).
                                let argExpr: t.Expression = arg as t.Expression;
                                while (t.isTSAsExpression(argExpr) || t.isTSSatisfiesExpression(argExpr)) {
                                    argExpr = argExpr.expression;
                                }
                                if (t.isIdentifier(argExpr)) {
                                    const binding = path.scope.getBinding(argExpr.name);
                                    if (!binding) {return;}
                                    const declarator = binding.path.node;
                                    if (!t.isVariableDeclarator(declarator) || !declarator.init) {return;}
                                    // Unwrap `as const` / `satisfies T` wrappers
                                    let initExpr = declarator.init;
                                    while (t.isTSAsExpression(initExpr) || t.isTSSatisfiesExpression(initExpr)) {
                                        initExpr = initExpr.expression;
                                    }
                                    if (!t.isObjectExpression(initExpr)) {return;}
                                    const staticObj = evaluateStaticObject(initExpr);
                                    if (!staticObj) {return;}
                                    const { className } = transform(staticObj as SzObject);
                                    for (const c of className.split(/\s+/)) {
                                        if (c) {collectedClasses.add(c);}
                                    }
                                }
                            },
                        },
                    };
                },
            ],
        });

        return {
            code: result?.code || source,
            transformed: transformed,
            usesRuntime: usesRuntime,
            usesMerge: usesMerge,
            usesColorVar: usesColorVar,
            classes: collectedClasses,
            rawClassNames,
            diagnostics,
            recoveryTokens,
        };
    } catch (e) {
        // Budget violations must propagate so the build aborts loudly with
        // a path the user can act on. Swallowing them would just hand back
        // unchanged source and let the OOM-prone file slip through.
        if (e instanceof ASTBudgetExceededError) {
            throw e;
        }
        console.warn('[csszyx] AST transform failed, falling back to original code:', e);
        return { code: source, transformed: false, usesRuntime: false, usesMerge: false, usesColorVar: false, classes: collectedClasses, rawClassNames, diagnostics, recoveryTokens };
    }
}

/**
 * Parses a CSS inline string (e.g. "--tw-translate-y: -50%; transform: translate(...)")
 * into a Babel ObjectExpression containing the properties.
 * @param styleStr - The CSS string to parse
 * @returns A Babel ObjectExpression node representing the parsed styles
 */
function parseStyleStringToObjectExpr(styleStr: string): t.ObjectExpression {
    const props = styleStr.split(';').map(s => s.trim()).filter(Boolean);
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
 * Recursively attempts to pre-compile an AST node to a static className expression.
 * Handles ObjectExpression (single static object), ConditionalExpression (ternary with static branches),
 * and StringLiteral (already resolved).
 *
 * @param node - AST node to attempt static transformation on
 * @param getBinding - Optional scope binding resolver for spread resolution
 * @returns A Babel AST node (StringLiteral or ConditionalExpression of strings), or null if dynamic
 */
function tryStaticTransformNode(node: t.Node, getBinding?: GetBinding): t.Expression | null {
    // Unwrap TypeScript type assertions — `as const` and `satisfies T` wrap the real node
    // in TSAsExpression / TSSatisfiesExpression; strip them before any type checks.
    if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node)) {
        return tryStaticTransformNode(node.expression, getBinding);
    }

    // Static object: { p: 4, bg: 'blue-500' } → "p-4 bg-blue-500"
    if (t.isObjectExpression(node)) {
        const resolved = getBinding ? resolveObjectSpreads(node, getBinding) ?? node : node;
        const staticObj = evaluateStaticObject(resolved);
        if (staticObj !== null) {
            const { className } = transform(staticObj);
            return t.stringLiteral(className);
        }
        // Hoist conditional spread: { ...(cond ? varA : varB), key: 'val' }
        // → cond ? "classes-a key-val" : "classes-b key-val"
        if (getBinding) {
            const hoisted = tryHoistConditionalSpread(node, getBinding);
            if (hoisted !== null) { return hoisted; }
        }
        return null;
    }

    // Already a string literal: pass through
    if (t.isStringLiteral(node)) {
        return node;
    }

    // Identifier: resolve the binding and recurse — handles sz={var}, array elements,
    // and ternary branches that are variable references rather than inline objects.
    if (t.isIdentifier(node) && getBinding) {
        const binding = getBinding(node.name);
        if (binding && binding.path.isVariableDeclarator()) {
            const init = binding.path.node.init;
            if (init) {
                return tryStaticTransformNode(init, getBinding);
            }
        }
        return null;
    }

    // Conditional expression: cond ? {...} : {...}
    // Recursively resolve both branches
    if (t.isConditionalExpression(node)) {
        const consequent = tryStaticTransformNode(node.consequent, getBinding);
        const alternate = tryStaticTransformNode(node.alternate, getBinding);
        if (consequent !== null && alternate !== null) {
            return t.conditionalExpression(node.test, consequent, alternate);
        }
        return null;
    }

    // Unary expression for negative numbers: not applicable here, skip
    return null;
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
        if (!t.isSpreadElement(prop)) { continue; }

        if (t.isConditionalExpression(prop.argument)) {
            // Allow exactly one conditional spread
            if (conditionalSpreadIdx !== -1) { return null; }
            conditionalSpreadIdx = i;
            conditionalExpr = prop.argument;
        } else {
            // Any other unresolved spread (e.g. imported var) → can't hoist
            return null;
        }
    }

    if (conditionalSpreadIdx === -1 || conditionalExpr === null) { return null; }

    // Build two ObjectExpressions — one per branch — then resolve each recursively.
    // The conditional spread is replaced by a plain identifier spread for that branch.
    const otherProps = node.properties.filter((_, i) => i !== conditionalSpreadIdx);
    const mkObj = (branch: t.Expression): t.ObjectExpression =>
        t.objectExpression([t.spreadElement(branch), ...otherProps]);

    const resolvedA = tryStaticTransformNode(mkObj(conditionalExpr.consequent), getBinding);
    const resolvedB = tryStaticTransformNode(mkObj(conditionalExpr.alternate), getBinding);

    // Both branches must fully resolve to static strings (no dynamic props allowed)
    if (!resolvedA || !resolvedB) { return null; }
    if (!t.isStringLiteral(resolvedA) || !t.isStringLiteral(resolvedB)) { return null; }

    return t.conditionalExpression(conditionalExpr.test, resolvedA, resolvedB);
}

/**
 * Recursively evaluates an ObjectExpression to a plain JS object if all properties are static literals.
 * Returns null if any part is dynamic.
 *
 * @param node - The ObjectExpression node to evaluate
 * @returns The evaluated object or null
 */
function evaluateStaticObject(node: t.ObjectExpression): SzObject | null {
    const result: SzObject = {};

    for (const prop of node.properties) {
        if (!t.isObjectProperty(prop)) {return null;} // Spread elements are dynamic
        if (prop.computed) {return null;} // Computed keys are dynamic

        let key: string;
        if (t.isIdentifier(prop.key)) {
            key = prop.key.name;
        } else if (t.isStringLiteral(prop.key)) {
            key = prop.key.value;
        } else if (t.isNumericLiteral(prop.key)) {
            key = String(prop.key.value);
        } else {
            return null;
        }

        const value = prop.value;
        if (t.isStringLiteral(value)) {
            result[key] = value.value;
        } else if (t.isNumericLiteral(value)) {
            result[key] = value.value;
        } else if (t.isBooleanLiteral(value)) {
            result[key] = value.value;
        } else if (t.isUnaryExpression(value) && value.operator === '-' && t.isNumericLiteral(value.argument)) {
            result[key] = -value.argument.value;
        } else if (t.isObjectExpression(value)) {
            const nested = evaluateStaticObject(value);
            if (nested === null) {return null;}
            result[key] = nested;
        } else {
            return null; // Dynamic value
        }
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
        if (!t.isSpreadElement(prop)) {
            // For regular properties whose value is a nested ObjectExpression, recurse
            // so that spreads inside variant/pseudo-element values are also resolved.
            // e.g. { before: { ...BASE, content: '' } } — spread is inside 'before' value.
            if (t.isObjectProperty(prop) && t.isObjectExpression(prop.value)) {
                const resolvedValue = resolveObjectSpreads(prop.value, getBinding);
                if (resolvedValue === null) { return null; }
                newProps.push(t.objectProperty(prop.key, resolvedValue, prop.computed, prop.shorthand));
            } else {
                newProps.push(prop);
            }
            continue;
        }
        // Only identifier spreads are resolvable: { ...localVar }
        const arg = prop.argument;
        if (!t.isIdentifier(arg)) { return null; }
        const binding = getBinding(arg.name);
        if (!binding || !binding.path.isVariableDeclarator()) { return null; }
        let init = binding.path.node.init;
        // Unwrap `as const` / `satisfies T` — both are TSAsExpression / TSSatisfiesExpression
        // wrapping the actual ObjectExpression.
        if (t.isTSAsExpression(init) || t.isTSSatisfiesExpression(init)) {
            init = init.expression;
        }
        if (!t.isObjectExpression(init)) { return null; }
        // Recurse so spreads-of-spreads also resolve
        const inner = resolveObjectSpreads(init, getBinding);
        if (inner === null) { return null; }
        newProps.push(...inner.properties);
    }
    return t.objectExpression(newProps);
}

// ============================================================================
// CSS VARIABLE AUTO-COMPILE: Partial Object Evaluation
// ============================================================================

/**
 *
 */
interface DynamicPropInfo {
    expression: t.Expression;
    category: PropertyCategory;
    varName: string;
    twPrefix: string;
    variantChain: string;
    skipClass?: boolean;
}

/**
 *
 */
interface ConditionalClassEntry {
    test: t.Expression;
    consequent: string; // compiled Tailwind class(es) for truthy branch
    alternate: string; // compiled Tailwind class(es) for falsy branch
}

/**
 *
 */
interface PartialObjectResult {
    staticProps: SzObject;
    dynamicProps: Map<string, DynamicPropInfo>;
    rawClasses: string[];
    conditionalClasses: ConditionalClassEntry[];
    hasSpread: boolean;
    usesColorVar: boolean;
}

/**
 * Extracts a primitive literal value from an AST expression, or returns null if dynamic.
 * @param node - AST expression to extract from
 * @returns primitive value or null
 */
function extractStaticLiteralValue(node: t.Expression): string | number | boolean | null {
    if (t.isStringLiteral(node)) { return node.value; }
    if (t.isNumericLiteral(node)) { return node.value; }
    if (t.isBooleanLiteral(node)) { return node.value; }
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
    if (conditionalClasses.length === 0) { return t.stringLiteral(baseClasses); }

    const makeCondExpr = (cc: ConditionalClassEntry): t.Expression =>
        t.conditionalExpression(cc.test, t.stringLiteral(cc.consequent), t.stringLiteral(cc.alternate));

    // Simple case: single conditional, no static base → bare ternary, no template overhead
    if (conditionalClasses.length === 1 && !baseClasses) {
        return makeCondExpr(conditionalClasses[0]);
    }

    // General case: template literal  `base ${c1} ${c2} …`
    const quasis: t.TemplateElement[] = [];
    const exprs: t.Expression[] = [];
    for (let i = 0; i < conditionalClasses.length; i++) {
        const prefix = i === 0 ? (baseClasses ? baseClasses + ' ' : '') : ' ';
        quasis.push(t.templateElement({ raw: prefix, cooked: prefix }, false));
        exprs.push(makeCondExpr(conditionalClasses[i]));
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
    const staticProps: SzObject = {};
    const dynamicProps = new Map<string, DynamicPropInfo>();
    const rawClasses: string[] = [];
    const conditionalClasses: ConditionalClassEntry[] = [];
    let usesColorVar = false;

    for (const prop of node.properties) {
        if (t.isSpreadElement(prop)) {
            return null; // Spread → fallback to _sz()
        }
        if (!t.isObjectProperty(prop)) {return null;}
        if (prop.computed) {return null;}

        let key: string;
        if (t.isIdentifier(prop.key)) {
            key = prop.key.name;
        } else if (t.isStringLiteral(prop.key)) {
            key = prop.key.value;
        } else if (t.isNumericLiteral(prop.key)) {
            key = String(prop.key.value);
        } else {
            return null;
        }

        const value = prop.value;

        // Try static evaluation first
        if (t.isStringLiteral(value)) {
            staticProps[key] = value.value;
        } else if (t.isNumericLiteral(value)) {
            staticProps[key] = value.value;
        } else if (t.isBooleanLiteral(value)) {
            staticProps[key] = value.value;
        } else if (t.isUnaryExpression(value) && value.operator === '-' && t.isNumericLiteral(value.argument)) {
            staticProps[key] = -value.argument.value;
        } else if (t.isObjectExpression(value)) {
            // Check if it's a static nested object (variant or color object)
            const nested = evaluateStaticObject(value);
            if (nested !== null) {
                staticProps[key] = nested;
            } else {
                // Check if it's a color object { color: ..., op: ... } with dynamic op
                const colorObjProps = new Map<string, t.ObjectProperty>();
                for (const p of value.properties) {
                    if (t.isObjectProperty(p) && !p.computed && t.isIdentifier(p.key)) {
                        colorObjProps.set(p.key.name, p);
                    }
                }
                if (colorObjProps.has('color') && COLOR_PROPERTIES.has(key)) {
                    const colorProp = colorObjProps.get('color');
                    if (!colorProp) {continue;}
                    const opProp = colorObjProps.get('op');
                    const twPrefix = PROPERTY_MAP[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

                    // Extract static color
                    let colorStr: string | null = null;
                    if (t.isStringLiteral(colorProp.value)) {
                        colorStr = colorProp.value.value;
                    }

                    if (colorStr && opProp) {
                        // Static color + dynamic op → bg-red-500/[var(--_sz-bg-op)]
                        const opVarName = getCSSVariableName(`${key}-op`, variantChain || undefined);
                        const uniqueKey = variantChain ? `${variantChain}-${key}-op` : `${key}-op`;

                        if (t.isStringLiteral(opProp.value) || t.isNumericLiteral(opProp.value)) {
                            // Both static — should have been caught above, but handle anyway
                            const opVal = t.isStringLiteral(opProp.value) ? opProp.value.value : opProp.value.value;
                            staticProps[key] = { color: colorStr, op: opVal } as unknown as SzValue;
                        } else if (t.isExpression(opProp.value)) {
                            // Static color + dynamic op — Tailwind v4 CSS variable shorthand
                            // Build final class directly: bg-red-500/(--_sz-bg-op)
                            const variantPfx = variantChain ? `${variantChain}:` : '';
                            rawClasses.push(`${variantPfx}${twPrefix}-${colorStr}/(${opVarName})`);
                            dynamicProps.set(uniqueKey, {
                                expression: opProp.value,
                                category: PropertyCategory.UNITLESS,
                                varName: opVarName,
                                twPrefix: `${twPrefix}-op`,
                                variantChain: variantChain || '',
                                skipClass: true,
                            });
                        }
                    } else if (!colorStr && opProp) {
                        // Both dynamic — fall through to CSS variable for entire bg
                        const varName = getCSSVariableName(key, variantChain || undefined);
                        const uniqueKey = variantChain ? `${variantChain}-${key}` : key;
                        usesColorVar = true;
                        dynamicProps.set(uniqueKey, {
                            expression: t.isExpression(colorProp.value) ? colorProp.value : t.stringLiteral(''),
                            category: PropertyCategory.COLOR,
                            varName,
                            twPrefix,
                            variantChain: variantChain || '',
                        });
                    } else if (colorStr && !opProp) {
                        // Static color, no op → just static
                        staticProps[key] = colorStr as unknown as SzValue;
                    }
                } else {
                    // Dynamic nested object — check if it's a variant
                    const isVariant = KNOWN_VARIANTS.has(key) || KNOWN_VARIANTS.has(getVariantPrefix(key));
                    if (isVariant) {
                        // Recursively evaluate variant's children
                        const variantKey = variantChain ? `${variantChain}-${key}` : key;
                        const nestedResult = evaluatePartialObject(value, variantKey);
                        if (nestedResult === null) {return null;}

                        // Merge static props under variant key
                        if (Object.keys(nestedResult.staticProps).length > 0) {
                            staticProps[key] = nestedResult.staticProps;
                        }
                        // Merge dynamic props
                        for (const [k, v] of nestedResult.dynamicProps) {
                            dynamicProps.set(k, v);
                        }
                        // Merge raw classes (e.g. from color object with dynamic op)
                        rawClasses.push(...nestedResult.rawClasses);
                        // Merge conditional classes (already have variant prefix applied)
                        conditionalClasses.push(...nestedResult.conditionalClasses);
                        if (nestedResult.usesColorVar) {usesColorVar = true;}
                    } else {
                        return null; // Unknown nested dynamic object
                    }
                }
            }
        } else if (t.isConditionalExpression(value)) {
            // Ternary where both branches are static literals:
            //   scale: shrunkA ? 75 : 100  →  shrunkA ? 'scale-75' : 'scale-100'
            // Compile each branch at build time instead of falling back to CSS variables.
            const consVal = extractStaticLiteralValue(value.consequent);
            const altVal = extractStaticLiteralValue(value.alternate);
            if (consVal !== null && altVal !== null) {
                const { className: classA } = transform({ [key]: consVal });
                const { className: classB } = transform({ [key]: altVal });
                // Apply variant prefix (e.g. 'hover' → 'hover:scale-75')
                const vPfx = variantChain ? getVariantPrefix(variantChain) + ':' : '';
                const prefixed = (cls: string): string =>
                    vPfx ? cls.split(/\s+/).filter(Boolean).map(c => vPfx + c).join(' ') : cls;
                conditionalClasses.push({ test: value.test, consequent: prefixed(classA), alternate: prefixed(classB) });
            } else {
                // At least one branch is dynamic — fall back to CSS variable
                const twPrefix = PROPERTY_MAP[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
                const category = getPropertyCategory(key);
                const varName = getCSSVariableName(key, variantChain || undefined);
                const uniqueKey = variantChain ? `${variantChain}-${key}` : key;
                if (COLOR_PROPERTIES.has(key)) { usesColorVar = true; }
                dynamicProps.set(uniqueKey, { expression: value, category, varName, twPrefix, variantChain: variantChain || '' });
            }
        } else if (t.isExpression(value)) {
            // Fully dynamic expression → CSS variable
            const twPrefix = PROPERTY_MAP[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
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
                variantChain: variantChain || '',
            });
        } else {
            return null;
        }
    }

    return { staticProps, dynamicProps, rawClasses, conditionalClasses, hasSpread: false, usesColorVar };
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
            return t.templateLiteral(
                [
                    t.templateElement({ raw: 'calc(', cooked: 'calc(' }, false),
                    t.templateElement({ raw: ' * var(--spacing))', cooked: ' * var(--spacing))' }, true),
                ],
                [expression],
            );

        case PropertyCategory.COLOR:
            return t.callExpression(
                t.identifier('__szColorVar'),
                [expression],
            );

        case PropertyCategory.ANGLE:
            return t.templateLiteral(
                [
                    t.templateElement({ raw: '', cooked: '' }, false),
                    t.templateElement({ raw: 'deg', cooked: 'deg' }, true),
                ],
                [expression],
            );

        case PropertyCategory.DURATION:
            return t.templateLiteral(
                [
                    t.templateElement({ raw: '', cooked: '' }, false),
                    t.templateElement({ raw: 'ms', cooked: 'ms' }, true),
                ],
                [expression],
            );

        case PropertyCategory.UNITLESS:
        case PropertyCategory.PASSTHROUGH:
        case PropertyCategory.FRACTION:
        case PropertyCategory.ARBITRARY:
        default:
            return t.templateLiteral(
                [
                    t.templateElement({ raw: '', cooked: '' }, false),
                    t.templateElement({ raw: '', cooked: '' }, true),
                ],
                [expression],
            );
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
        for (const c of node.value.split(/\s+/)) {
            if (c) {classes.add(c);}
        }
    } else if (t.isConditionalExpression(node)) {
        collectFromExpr(node.consequent as t.Expression, classes);
        collectFromExpr(node.alternate as t.Expression, classes);
    }
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
    const variantPrefix = variantChain
        ? `${getVariantPrefix(variantChain)}:`
        : '';
    return `${variantPrefix}${twPrefix}-(${varName})`;
}
