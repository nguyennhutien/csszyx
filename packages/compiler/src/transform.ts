
import * as babel from '@babel/core';
import * as t from '@babel/types';

import { COLOR_PROPERTIES, getCSSVariableName, getPropertyCategory, PropertyCategory } from './property-types.js';
import {
    getVariantPrefix,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    SzObject,
    SzValue,
    transform } from './transform-core.js';

// Re-export everything from core so consumers don't break
export * from './transform-core.js';

/**
 * Transforms all sz props in a source code string into Tailwind classNames.
 *
 * @param {string} source - The source code to transform
 * @returns {object} Transformation result with code and metadata
 */
export function transformSourceCode(source: string): { code: string; transformed: boolean; usesRuntime: boolean; usesColorVar: boolean; classes: Set<string> } {
    let usesRuntime = false;
    let usesColorVar = false;
    let transformed = false;
    const collectedClasses = new Set<string>();

    // Fast path: check if file contains 'sz' before parsing
    if (!source.includes('sz')) {
        return { code: source, transformed: false, usesRuntime: false, usesColorVar: false, classes: collectedClasses };
    }

    try {
        const result = babel.transformSync(source, {
            filename: 'file.tsx', // Enable TS/JSX parsing
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
                        visitor: {
                            JSXAttribute(path: babel.NodePath<t.JSXAttribute>) {
                                const attrName = t.isJSXIdentifier(path.node.name)
                                    ? path.node.name.name
                                    : '';

                                // Piggyback: collect existing className/class string literal values.
                                // Only JSXAttribute nodes are visited here — text content, JSDoc,
                                // and string literals in other positions are different AST node
                                // types and never reach this visitor, eliminating false positives.
                                if (attrName === 'className' || attrName === 'class') {
                                    const val = path.node.value;
                                    if (t.isStringLiteral(val)) {
                                        for (const c of val.value.split(/\s+/)) {
                                            if (c) {collectedClasses.add(c);}
                                        }
                                    }
                                    return;
                                }

                                if (attrName !== 'sz') {return;}

                                const value = path.node.value;

                                // Case 1: sz="string"
                                if (t.isStringLiteral(value)) {
                                    path.node.name.name = 'className';
                                    for (const c of value.value.split(/\s+/)) {
                                        if (c) {collectedClasses.add(c);}
                                    }
                                    transformed = true;
                                    return;
                                }

                                // Case 2: sz={...}
                                if (t.isJSXExpressionContainer(value)) {
                                    const expression = value.expression;

                                    // Static Extraction Logic: sz={{ p: 4, bg: 'blue' }}
                                    if (t.isObjectExpression(expression)) {
                                        const staticObject = evaluateStaticObject(expression);
                                        if (staticObject !== null) {
                                            // Compile time transformation
                                            const { className, attributes } = transform(staticObject);
                                            for (const c of className.split(/\s+/)) {
                                                if (c) {collectedClasses.add(c);}
                                            }
                                            path.node.name.name = 'className';
                                            path.node.value = t.stringLiteral(className);

                                            // Inject attributes (will-change)
                                            Object.entries(attributes).forEach(([key, val]) => {
                                                if (path.parentPath?.isJSXOpeningElement()) {
                                                    path.parentPath.node.attributes.push(
                                                        t.jsxAttribute(
                                                            t.jsxIdentifier(key),
                                                            t.stringLiteral(val),
                                                        ),
                                                    );
                                                }
                                            });

                                            transformed = true;
                                            return;
                                        }

                                        // CSS Variable Auto-Compile: partial static/dynamic
                                        const partial = evaluatePartialObject(expression);
                                        if (partial !== null && !partial.hasSpread && partial.dynamicProps.size > 0) {
                                            // Build static class string from static props
                                            const staticClasses: string[] = [];
                                            if (Object.keys(partial.staticProps).length > 0) {
                                                const { className: sc } = transform(partial.staticProps);
                                                if (sc) {staticClasses.push(sc);}
                                            }

                                            // Build CSS variable class strings
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

                                            // Combine all classes into a single string
                                            const allClasses = [...staticClasses, ...partial.rawClasses, ...cssVarClasses].join(' ');
                                            for (const c of allClasses.split(/\s+/)) {
                                                if (c) {collectedClasses.add(c);}
                                            }

                                            // Set className
                                            path.node.name.name = 'className';
                                            path.node.value = t.stringLiteral(allClasses);

                                            // Inject style attribute
                                            if (styleProps.length > 0 && path.parentPath?.isJSXOpeningElement()) {
                                                const styleAttr = t.jsxAttribute(
                                                    t.jsxIdentifier('style'),
                                                    t.jsxExpressionContainer(
                                                        t.objectExpression(styleProps),
                                                    ),
                                                );
                                                path.parentPath.node.attributes.push(styleAttr);
                                            }

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
                                                const resolved = tryStaticTransformNode(init);
                                                if (resolved !== null) {
                                                    path.node.name.name = 'className';
                                                    if (t.isStringLiteral(resolved)) {
                                                        path.node.value = resolved;
                                                        for (const c of resolved.value.split(/\s+/)) {
                                                            if (c) {collectedClasses.add(c);}
                                                        }
                                                    } else {
                                                        value.expression = resolved;
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
                                        const resolved = tryStaticTransformNode(expression);
                                        if (resolved !== null) {
                                            path.node.name.name = 'className';
                                            if (t.isStringLiteral(resolved)) {
                                                path.node.value = resolved;
                                                for (const c of resolved.value.split(/\s+/)) {
                                                    if (c) {collectedClasses.add(c);}
                                                }
                                            } else {
                                                value.expression = resolved;
                                                collectFromExpr(resolved, collectedClasses);
                                            }
                                            transformed = true;
                                            return;
                                        }
                                    }

                                    // Fallback: Runtime wrapper
                                    path.node.name.name = 'className';
                                    const szCall = t.callExpression(
                                        t.identifier('_sz'),
                                        [expression as t.Expression],
                                    );
                                    value.expression = szCall;
                                    usesRuntime = true;
                                    transformed = true;
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
            usesColorVar: usesColorVar,
            classes: collectedClasses,
        };
    } catch (e) {
        console.warn('[csszyx] AST transform failed, falling back to original code:', e);
        return { code: source, transformed: false, usesRuntime: false, usesColorVar: false, classes: collectedClasses };
    }
}

/**
 * Recursively attempts to pre-compile an AST node to a static className expression.
 * Handles ObjectExpression (single static object), ConditionalExpression (ternary with static branches),
 * and StringLiteral (already resolved).
 *
 * @param node - AST node to attempt static transformation on
 * @returns A Babel AST node (StringLiteral or ConditionalExpression of strings), or null if dynamic
 */
function tryStaticTransformNode(node: t.Node): t.Expression | null {
    // Static object: { p: 4, bg: 'blue-500' } → "p-4 bg-blue-500"
    if (t.isObjectExpression(node)) {
        const staticObj = evaluateStaticObject(node);
        if (staticObj !== null) {
            const { className } = transform(staticObj);
            return t.stringLiteral(className);
        }
        return null;
    }

    // Already a string literal: pass through
    if (t.isStringLiteral(node)) {
        return node;
    }

    // Conditional expression: cond ? {...} : {...}
    // Recursively resolve both branches
    if (t.isConditionalExpression(node)) {
        const consequent = tryStaticTransformNode(node.consequent);
        const alternate = tryStaticTransformNode(node.alternate);
        if (consequent !== null && alternate !== null) {
            return t.conditionalExpression(node.test, consequent, alternate);
        }
        return null;
    }

    // Unary expression for negative numbers: not applicable here, skip
    return null;
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
interface PartialObjectResult {
    staticProps: SzObject;
    dynamicProps: Map<string, DynamicPropInfo>;
    rawClasses: string[];
    hasSpread: boolean;
    usesColorVar: boolean;
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
                            // Static color + dynamic op
                            // Build final class directly: bg-red-500/[var(--_sz-bg-op)]
                            const variantPfx = variantChain ? `${variantChain}:` : '';
                            rawClasses.push(`${variantPfx}${twPrefix}-${colorStr}/[var(${opVarName})]`);
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
                        if (nestedResult.usesColorVar) {usesColorVar = true;}
                    } else {
                        return null; // Unknown nested dynamic object
                    }
                }
            }
        } else if (t.isExpression(value)) {
            // Dynamic expression → CSS variable
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

    return { staticProps, dynamicProps, rawClasses, hasSpread: false, usesColorVar };
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
 * e.g., p -> "p-[var(--_sz-p)]", hover:bg -> "hover:bg-[var(--_sz-hover-bg)]"
 * @param info - the dynamic property info containing prefix, var name, and variant chain
 * @returns the CSS class name string using a CSS variable reference
 */
function buildCSSVarClassName(info: DynamicPropInfo): string {
    const { twPrefix, varName, variantChain } = info;
    const variantPrefix = variantChain
        ? `${getVariantPrefix(variantChain)}:`
        : '';
    return `${variantPrefix}${twPrefix}-[var(${varName})]`;
}
