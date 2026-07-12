/**
 * hoistCSSVariables against a REAL parsed AST — the mock-element suite cannot
 * reach the LCA walk, the Fragment bail, or the add/remove rewrites, because
 * those need a genuine parent chain built from source.
 */
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { describe, expect, it } from 'vitest';

import { buildParentMap, type CSSVarUsage, hoistCSSVariables } from '../src/hoisting.js';

/** Parse JSX and collect opening elements by tag name.
 * @param code - Source containing JSX.
 * @returns The program node plus a tag-name lookup.
 */
function parseJsx(code: string): {
    ast: t.Node;
    byName: (name: string) => t.JSXOpeningElement;
} {
    const ast = parse(code, { plugins: ['jsx'], sourceType: 'module' }).program;
    const found = new Map<string, t.JSXOpeningElement>();
    const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        const candidate = node as t.Node;
        if (t.isJSXOpeningElement(candidate) && t.isJSXIdentifier(candidate.name)) {
            found.set(candidate.name.name, candidate);
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
            const element = found.get(name);
            if (!element) throw new Error(`no <${name}> in fixture`);
            return element;
        },
    };
}

/** Build a style-var usage for an element (adds the style attr it hoists from).
 * @param element - Element the variable currently lives on.
 * @param varName - CSS variable name.
 * @param value - Serialized variable value.
 * @returns The usage record hoistCSSVariables consumes.
 */
function usageOn(element: t.JSXOpeningElement, varName: string, value: string): CSSVarUsage {
    element.attributes.push(
        t.jsxAttribute(
            t.jsxIdentifier('style'),
            t.jsxExpressionContainer(
                t.objectExpression([
                    t.objectProperty(t.stringLiteral(varName), t.stringLiteral(value)),
                ]),
            ),
        ),
    );
    return {
        element,
        varName,
        valueExpr: t.stringLiteral(value),
        serializedValue: `S:${value}`,
    };
}

/** Read the style-var names present on an element.
 * @param element - Element whose style attribute to inspect.
 * @returns The declared CSS variable names.
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

describe('hoistCSSVariables over a parsed tree', () => {
    it('hoists an identical variable from two siblings onto their parent', () => {
        const { ast, byName } = parseJsx(
            'const A = () => (<section><div id="a" /><div id="b" /><span /></section>);',
        );
        // The two <div>s aren't distinguishable by tag; use section children directly.
        const section = byName('section');
        const parentMap = buildParentMap(ast);
        // Locate the two child divs via the parent map keys.
        const children: t.JSXOpeningElement[] = [];
        for (const key of parentMap.keys()) {
            if (
                t.isJSXOpeningElement(key) &&
                t.isJSXIdentifier(key.name) &&
                key.name.name === 'div'
            )
                children.push(key);
        }
        expect(children).toHaveLength(2);

        const usages = children.map(child => usageOn(child, '--_sz-p', 'calc(4*var(--spacing))'));
        hoistCSSVariables(usages, parentMap);

        expect(styleVarNames(section)).toContain('--_sz-p');
        for (const child of children) expect(styleVarNames(child)).not.toContain('--_sz-p');
    });

    it('does not hoist across a Fragment ancestor', () => {
        const { ast, byName } = parseJsx(
            'const A = () => (<Fragment><div id="a" /><p id="b" /></Fragment>);',
        );
        const parentMap = buildParentMap(ast);
        const usages = [
            usageOn(byName('div'), '--_sz-m', '8px'),
            usageOn(byName('p'), '--_sz-m', '8px'),
        ];
        hoistCSSVariables(usages, parentMap);
        // Nothing moved: both keep their own variable.
        expect(styleVarNames(byName('div'))).toContain('--_sz-m');
        expect(styleVarNames(byName('p'))).toContain('--_sz-m');
    });

    it('skips dynamic (null-serialized) usages and lone group members', () => {
        const { ast, byName } = parseJsx(
            'const A = () => (<main><div id="a" /><p id="b" /></main>);',
        );
        const parentMap = buildParentMap(ast);
        const dynamic = usageOn(byName('div'), '--_sz-w', '1px');
        dynamic.serializedValue = null;
        const lone = usageOn(byName('p'), '--_sz-h', '2px');
        hoistCSSVariables([dynamic, lone], parentMap);
        expect(styleVarNames(byName('main'))).toHaveLength(0);
    });

    it('merges into an existing style attribute on the ancestor and keeps siblings', () => {
        const { ast, byName } = parseJsx(
            'const A = () => (<main id="x" style={{"--keep": "1"}}><div id="a" /><p id="b" /></main>);',
        );
        const parentMap = buildParentMap(ast);
        const divUsage = usageOn(byName('div'), '--_sz-p', '4px');
        // The div carries a second variable that must survive the removal.
        const styleAttr = byName('div').attributes.find(
            (attr): attr is t.JSXAttribute =>
                t.isJSXAttribute(attr) &&
                t.isJSXIdentifier(attr.name) &&
                attr.name.name === 'style',
        );
        if (styleAttr && t.isJSXExpressionContainer(styleAttr.value)) {
            const expr = styleAttr.value.expression;
            if (t.isObjectExpression(expr)) {
                expr.properties.push(
                    t.objectProperty(t.stringLiteral('--stay'), t.stringLiteral('2')),
                );
            }
        }
        const usages = [divUsage, usageOn(byName('p'), '--_sz-p', '4px')];
        hoistCSSVariables(usages, parentMap);

        const mainVars = styleVarNames(byName('main'));
        expect(mainVars).toContain('--keep');
        expect(mainVars).toContain('--_sz-p');
        expect(styleVarNames(byName('div'))).toEqual(['--stay']);
        // The now-empty <p> style attribute is removed entirely.
        expect(styleVarNames(byName('p'))).toHaveLength(0);
    });

    it('does not duplicate a variable the ancestor already declares', () => {
        const { ast, byName } = parseJsx(
            'const A = () => (<main style={{"--_sz-p": "4px"}}><div id="a" /><p id="b" /></main>);',
        );
        const parentMap = buildParentMap(ast);
        hoistCSSVariables(
            [usageOn(byName('div'), '--_sz-p', '4px'), usageOn(byName('p'), '--_sz-p', '4px')],
            parentMap,
        );
        const names = styleVarNames(byName('main')).filter(name => name === '--_sz-p');
        expect(names).toHaveLength(1);
    });

    it('hoists different variable groups to the same ancestor independently', () => {
        const { ast, byName } = parseJsx(
            'const A = () => (<main><div id="a" /><p id="b" /></main>);',
        );
        const parentMap = buildParentMap(ast);
        const usages = [
            usageOn(byName('div'), '--_sz-p', '4px'),
            usageOn(byName('p'), '--_sz-p', '4px'),
            usageOn(byName('div'), '--_sz-m', '9px'),
            usageOn(byName('p'), '--_sz-m', '2px'), // different value → separate groups of 1
        ];
        hoistCSSVariables(usages, parentMap);
        const hoisted = styleVarNames(byName('main'));
        expect(hoisted).toContain('--_sz-p');
        expect(hoisted).not.toContain('--_sz-m');
    });
});
