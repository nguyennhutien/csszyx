/**
 * Complementary branch-coverage suite for CSS-variable hoisting. It reaches the
 * internal JSX helpers the primary suites skip: findLCA's opening/element/null
 * ternary arms, isFragment's member-expression and namespaced-name paths,
 * removeStyleVar / addStyleVar attribute-skip and property-skip branches, and
 * buildParentMap's array-hole guard. Hand-built elements pin exact attribute
 * shapes; parsed fixtures reach the JSXElement-wrapper walk.
 */
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { describe, expect, it } from 'vitest';

import { buildParentMap, type CSSVarUsage, hoistCSSVariables } from '../src/hoisting.js';

/** Build a `style={{...}}` attribute from object members.
 * @param props - Object members (properties and/or spreads).
 * @returns A style JSX attribute wrapping an object expression.
 */
function styleObjectAttr(props: (t.ObjectProperty | t.SpreadElement)[]): t.JSXAttribute {
    return t.jsxAttribute(
        t.jsxIdentifier('style'),
        t.jsxExpressionContainer(t.objectExpression(props)),
    );
}

/** Build a `style="..."` attribute whose value is a plain string literal.
 * @returns A style JSX attribute with a string-literal value (no container).
 */
function styleStringAttr(): t.JSXAttribute {
    return t.jsxAttribute(t.jsxIdentifier('style'), t.stringLiteral('color:red'));
}

/** Build a `style={ident}` attribute whose container is not an object.
 * @returns A style JSX attribute wrapping a bare identifier.
 */
function styleIdentifierAttr(): t.JSXAttribute {
    return t.jsxAttribute(
        t.jsxIdentifier('style'),
        t.jsxExpressionContainer(t.identifier('dynamic')),
    );
}

/** A string-keyed CSS-variable object member.
 * @param name - CSS variable name.
 * @param value - Serialized value.
 * @returns The object property.
 */
function varProp(name: string, value: string): t.ObjectProperty {
    return t.objectProperty(t.stringLiteral(name), t.stringLiteral(value));
}

/** Read the string-literal style-variable names declared on an element.
 * @param element - Element whose style attributes to inspect.
 * @returns Declared CSS variable / property names.
 */
function styleVarNames(element: t.JSXOpeningElement): string[] {
    const names: string[] = [];
    for (const attr of element.attributes) {
        if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
        if (attr.name.name !== 'style' || !t.isJSXExpressionContainer(attr.value)) continue;
        const expr = attr.value.expression;
        if (!t.isObjectExpression(expr)) continue;
        for (const prop of expr.properties) {
            if (t.isObjectProperty(prop) && t.isStringLiteral(prop.key)) names.push(prop.key.value);
        }
    }
    return names;
}

/** Whether the element still carries any `style` attribute.
 * @param element - Element to inspect.
 * @returns True when a style attribute is present.
 */
function hasStyleAttr(element: t.JSXOpeningElement): boolean {
    return element.attributes.some(
        attr =>
            t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'style',
    );
}

/** A matching same-name/same-value usage for a hand-built element.
 * @param element - Element that owns the variable.
 * @param varName - CSS variable name.
 * @param value - Serialized value.
 * @returns The usage record.
 */
function usage(element: t.JSXOpeningElement, varName: string, value: string): CSSVarUsage {
    return {
        element,
        varName,
        valueExpr: t.stringLiteral(value),
        serializedValue: `S:${value}`,
    };
}

/** Parent map that makes two children hoist onto a shared parent element.
 * @param parent - Shared parent opening element.
 * @param children - Child opening elements.
 * @returns A hand-built child-to-parent map.
 */
function directParentMap(
    parent: t.JSXOpeningElement,
    children: t.JSXOpeningElement[],
): Map<t.Node, t.Node> {
    const map = new Map<t.Node, t.Node>();
    for (const child of children) map.set(child, parent);
    return map;
}

describe('hoistCSSVariables — hand-built element branches', () => {
    it('creates a new style attribute on a bare ancestor and removes emptied children', () => {
        const parent = t.jsxOpeningElement(t.jsxIdentifier('section'), [], false);
        const childA = t.jsxOpeningElement(
            t.jsxIdentifier('div'),
            [varAttr('--_sz-p', '4px')],
            false,
        );
        const childB = t.jsxOpeningElement(
            t.jsxIdentifier('div'),
            [varAttr('--_sz-p', '4px')],
            false,
        );

        hoistCSSVariables(
            [usage(childA, '--_sz-p', '4px'), usage(childB, '--_sz-p', '4px')],
            directParentMap(parent, [childA, childB]),
        );

        expect(styleVarNames(parent)).toContain('--_sz-p');
        expect(hasStyleAttr(childA)).toBe(false);
        expect(hasStyleAttr(childB)).toBe(false);
    });

    it('removeStyleVar skips spreads, string styles, non-object styles, spread props, non-string keys', () => {
        const parent = t.jsxOpeningElement(t.jsxIdentifier('section'), [], false);
        // childA carries every removeStyleVar skip case before the real object style.
        const childA = t.jsxOpeningElement(
            t.jsxIdentifier('div'),
            [
                t.jsxSpreadAttribute(t.identifier('props')),
                t.jsxAttribute(t.jsxIdentifier('className'), t.stringLiteral('c')),
                styleStringAttr(),
                styleIdentifierAttr(),
                styleObjectAttr([
                    t.spreadElement(t.identifier('base')),
                    t.objectProperty(t.identifier('color'), t.stringLiteral('red')),
                    varProp('--_sz-p', '4px'),
                ]),
            ],
            false,
        );
        const childB = t.jsxOpeningElement(
            t.jsxIdentifier('div'),
            [varAttr('--_sz-p', '4px')],
            false,
        );

        hoistCSSVariables(
            [usage(childA, '--_sz-p', '4px'), usage(childB, '--_sz-p', '4px')],
            directParentMap(parent, [childA, childB]),
        );

        expect(styleVarNames(parent)).toContain('--_sz-p');
        // The var is gone but the spread + identifier-keyed `color` members are
        // kept (they hit the object-property skip branches), so the style
        // object is not emptied and the attribute survives.
        expect(styleVarNames(childA)).not.toContain('--_sz-p');
        expect(hasStyleAttr(childA)).toBe(true);
    });

    it('addStyleVar skips spreads, string styles, and non-object styles before the object style', () => {
        const parent = t.jsxOpeningElement(
            t.jsxIdentifier('section'),
            [
                t.jsxSpreadAttribute(t.identifier('props')),
                t.jsxAttribute(t.jsxIdentifier('className'), t.stringLiteral('c')),
                styleStringAttr(),
                styleIdentifierAttr(),
                styleObjectAttr([varProp('--other', 'x')]),
            ],
            false,
        );
        const childA = t.jsxOpeningElement(
            t.jsxIdentifier('div'),
            [varAttr('--_sz-p', '4px')],
            false,
        );
        const childB = t.jsxOpeningElement(
            t.jsxIdentifier('div'),
            [varAttr('--_sz-p', '4px')],
            false,
        );

        hoistCSSVariables(
            [usage(childA, '--_sz-p', '4px'), usage(childB, '--_sz-p', '4px')],
            directParentMap(parent, [childA, childB]),
        );

        const names = styleVarNames(parent);
        expect(names).toContain('--other');
        expect(names).toContain('--_sz-p');
    });

    it('addStyleVar does not duplicate a variable the ancestor already declares', () => {
        const parent = t.jsxOpeningElement(
            t.jsxIdentifier('section'),
            [styleObjectAttr([varProp('--_sz-p', '4px')])],
            false,
        );
        const childA = t.jsxOpeningElement(
            t.jsxIdentifier('div'),
            [varAttr('--_sz-p', '4px')],
            false,
        );
        const childB = t.jsxOpeningElement(
            t.jsxIdentifier('div'),
            [varAttr('--_sz-p', '4px')],
            false,
        );

        hoistCSSVariables(
            [usage(childA, '--_sz-p', '4px'), usage(childB, '--_sz-p', '4px')],
            directParentMap(parent, [childA, childB]),
        );

        expect(styleVarNames(parent).filter(name => name === '--_sz-p')).toHaveLength(1);
    });
});

/** Single-var style attribute helper.
 * @param name - CSS variable name.
 * @param value - Serialized value.
 * @returns A style attribute declaring exactly that variable.
 */
function varAttr(name: string, value: string): t.JSXAttribute {
    return styleObjectAttr([varProp(name, value)]);
}

/** Parse JSX source and index its opening elements.
 * @param code - Source containing JSX.
 * @returns The program plus opening-element accessors.
 */
function parseJsx(code: string): {
    ast: t.Node;
    byName: (name: string) => t.JSXOpeningElement;
    memberElement: () => t.JSXOpeningElement;
} {
    const ast = parse(code, { plugins: ['jsx'], sourceType: 'module' }).program;
    const named = new Map<string, t.JSXOpeningElement>();
    const members: t.JSXOpeningElement[] = [];
    const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        const candidate = node as t.Node;
        if (t.isJSXOpeningElement(candidate)) {
            if (t.isJSXIdentifier(candidate.name)) named.set(candidate.name.name, candidate);
            else members.push(candidate);
        }
        for (const key of Object.keys(candidate)) {
            if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
            walk((candidate as unknown as Record<string, unknown>)[key]);
        }
    };
    walk(ast);
    return {
        ast,
        byName: name => {
            const element = named.get(name);
            if (!element) throw new Error(`no <${name}> in fixture`);
            return element;
        },
        memberElement: () => {
            const element = members[0];
            if (!element) throw new Error('no member-expression element in fixture');
            return element;
        },
    };
}

/** Attach a style variable to a parsed element and return its usage.
 * @param element - Element the variable currently lives on.
 * @param varName - CSS variable name.
 * @param value - Serialized value.
 * @returns The usage record.
 */
function usageOn(element: t.JSXOpeningElement, varName: string, value: string): CSSVarUsage {
    element.attributes.push(varAttr(varName, value));
    return usage(element, varName, value);
}

describe('hoistCSSVariables — parsed-tree branches', () => {
    it('hoists identical siblings through their JSXElement-wrapped ancestor', () => {
        const { ast, byName } = parseJsx('const A = () => (<section><a /><b /></section>);');
        const parentMap = buildParentMap(ast);
        hoistCSSVariables(
            [usageOn(byName('a'), '--_sz-p', '4px'), usageOn(byName('b'), '--_sz-p', '4px')],
            parentMap,
        );

        expect(styleVarNames(byName('section'))).toContain('--_sz-p');
        expect(hasStyleAttr(byName('a'))).toBe(false);
        expect(hasStyleAttr(byName('b'))).toBe(false);
    });

    it('does not hoist across an anonymous <> fragment (no JSX-element ancestor)', () => {
        const { ast, byName } = parseJsx('const A = () => (<><a /><b /></>);');
        const parentMap = buildParentMap(ast);
        hoistCSSVariables(
            [usageOn(byName('a'), '--_sz-m', '8px'), usageOn(byName('b'), '--_sz-m', '8px')],
            parentMap,
        );

        expect(styleVarNames(byName('a'))).toContain('--_sz-m');
        expect(styleVarNames(byName('b'))).toContain('--_sz-m');
    });

    it('does not hoist when one element is nested inside the other', () => {
        const { ast, byName } = parseJsx('const A = () => (<div id="outer"><p /></div>);');
        const parentMap = buildParentMap(ast);
        // The <div> owns the <p>, so their only common opening element is the
        // <div> itself, which findLCA rejects as the group anchor.
        hoistCSSVariables(
            [usageOn(byName('div'), '--_sz-h', '2px'), usageOn(byName('p'), '--_sz-h', '2px')],
            parentMap,
        );

        expect(styleVarNames(byName('div'))).toContain('--_sz-h');
        expect(styleVarNames(byName('p'))).toContain('--_sz-h');
    });

    it('does not hoist onto a <React.Fragment> member-expression ancestor', () => {
        const { ast, byName } = parseJsx(
            'const A = () => (<React.Fragment><a /><b /></React.Fragment>);',
        );
        const parentMap = buildParentMap(ast);
        hoistCSSVariables(
            [usageOn(byName('a'), '--_sz-w', '1px'), usageOn(byName('b'), '--_sz-w', '1px')],
            parentMap,
        );

        expect(styleVarNames(byName('a'))).toContain('--_sz-w');
        expect(styleVarNames(byName('b'))).toContain('--_sz-w');
    });

    it('does hoist onto a non-Fragment member-expression ancestor', () => {
        const { ast, byName, memberElement } = parseJsx(
            'const A = () => (<Foo.Bar><a /><b /></Foo.Bar>);',
        );
        const parentMap = buildParentMap(ast);
        hoistCSSVariables(
            [usageOn(byName('a'), '--_sz-x', '5px'), usageOn(byName('b'), '--_sz-x', '5px')],
            parentMap,
        );

        // Foo.Bar is not a Fragment, so it legitimately receives the hoisted var.
        expect(styleVarNames(memberElement())).toContain('--_sz-x');
    });

    it('does hoist onto a namespaced ancestor element', () => {
        const { ast, byName, memberElement } = parseJsx(
            'const A = () => (<svg:g><a /><b /></svg:g>);',
        );
        const parentMap = buildParentMap(ast);
        hoistCSSVariables(
            [usageOn(byName('a'), '--_sz-y', '6px'), usageOn(byName('b'), '--_sz-y', '6px')],
            parentMap,
        );

        // A namespaced element name is neither identifier nor member expression,
        // so isFragment reports false and the hoist proceeds.
        expect(styleVarNames(memberElement())).toContain('--_sz-y');
    });

    it('does not hoist onto a bare <Fragment> identifier ancestor', () => {
        const { ast, byName } = parseJsx('const A = () => (<Fragment><a /><b /></Fragment>);');
        const parentMap = buildParentMap(ast);
        hoistCSSVariables(
            [usageOn(byName('a'), '--_sz-z', '7px'), usageOn(byName('b'), '--_sz-z', '7px')],
            parentMap,
        );

        expect(styleVarNames(byName('a'))).toContain('--_sz-z');
        expect(styleVarNames(byName('b'))).toContain('--_sz-z');
    });
});

describe('hoistCSSVariables — group guard branches', () => {
    it('returns without change for fewer than two usages', () => {
        const empty = new Map<t.Node, t.Node>();
        expect(() => hoistCSSVariables([], empty)).not.toThrow();

        const solo = t.jsxOpeningElement(
            t.jsxIdentifier('div'),
            [varAttr('--_sz-p', '4px')],
            false,
        );
        hoistCSSVariables([usage(solo, '--_sz-p', '4px')], empty);
        expect(hasStyleAttr(solo)).toBe(true);
    });

    it('skips dynamic (null-serialized) usages and any leftover single-member group', () => {
        const parent = t.jsxOpeningElement(t.jsxIdentifier('section'), [], false);
        const dyn = t.jsxOpeningElement(t.jsxIdentifier('div'), [varAttr('--_sz-p', 'x')], false);
        const lone = t.jsxOpeningElement(t.jsxIdentifier('span'), [varAttr('--_sz-p', 'x')], false);
        const dynamicUsage: CSSVarUsage = {
            element: dyn,
            varName: '--_sz-p',
            valueExpr: t.identifier('runtime'),
            serializedValue: null,
        };

        hoistCSSVariables(
            [dynamicUsage, usage(lone, '--_sz-p', 'x')],
            directParentMap(parent, [dyn, lone]),
        );

        // The dynamic usage is dropped before grouping, leaving a lone static
        // member, so nothing is hoisted onto the parent.
        expect(hasStyleAttr(parent)).toBe(false);
        expect(hasStyleAttr(dyn)).toBe(true);
        expect(hasStyleAttr(lone)).toBe(true);
    });
});

describe('buildParentMap — array-hole guard', () => {
    it('skips sparse array holes without mapping them', () => {
        const ast = parse('const x = [1, , 2];', { sourceType: 'module' }).program;
        // The array has a null element hole; buildParentMap must traverse the
        // real numeric literals and ignore the hole without throwing.
        const map = buildParentMap(ast);
        expect(map.size).toBeGreaterThan(0);
        expect([...map.keys()].some(node => t.isNumericLiteral(node))).toBe(true);
    });
});
