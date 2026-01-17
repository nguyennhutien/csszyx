import * as t from '@babel/types';
import { describe, expect, it } from 'vitest';

import { buildParentMap, type CSSVarUsage, hoistCSSVariables } from '../src/hoisting.js';

/**
 * Helper to create a mock JSX opening element with optional style attribute.
 * @param name - the element tag name
 * @param styleVars - optional map of CSS variable names to values
 * @returns a JSXOpeningElement node with the given attributes
 */
function createMockElement(name: string, styleVars?: Record<string, string>): t.JSXOpeningElement {
    const attrs: t.JSXAttribute[] = [];

    if (styleVars && Object.keys(styleVars).length > 0) {
        const props = Object.entries(styleVars).map(([key, val]) =>
            t.objectProperty(t.stringLiteral(key), t.stringLiteral(val)),
        );
        attrs.push(
            t.jsxAttribute(
                t.jsxIdentifier('style'),
                t.jsxExpressionContainer(t.objectExpression(props)),
            ),
        );
    }

    return t.jsxOpeningElement(t.jsxIdentifier(name), attrs, false);
}

describe('hoistCSSVariables', () => {
    it('should not hoist when only one usage', () => {
        const element = createMockElement('div', { '--_sz-p': 'calc(4 * var(--spacing))' });
        const usage: CSSVarUsage = {
            element,
            varName: '--_sz-p',
            valueExpr: t.stringLiteral('calc(4 * var(--spacing))'),
            serializedValue: 'S:calc(4 * var(--spacing))',
        };
        const parentMap = new Map<t.Node, t.Node>();

        hoistCSSVariables([usage], parentMap);
        // Style should remain on element
        const style = element.attributes.find(a =>
            t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'style',
        );
        expect(style).toBeDefined();
    });

    it('should skip hoisting when serializedValue is null (dynamic)', () => {
        const el1 = createMockElement('div', { '--_sz-p': 'dynamic' });
        const el2 = createMockElement('div', { '--_sz-p': 'dynamic' });
        const usages: CSSVarUsage[] = [
            { element: el1, varName: '--_sz-p', valueExpr: t.identifier('x'), serializedValue: null },
            { element: el2, varName: '--_sz-p', valueExpr: t.identifier('x'), serializedValue: null },
        ];
        const parentMap = new Map<t.Node, t.Node>();

        hoistCSSVariables(usages, parentMap);
        // Both should keep their style
        for (const el of [el1, el2]) {
            const style = el.attributes.find(a =>
                t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'style',
            );
            expect(style).toBeDefined();
        }
    });

    it('should not hoist when different values', () => {
        const el1 = createMockElement('div', { '--_sz-p': 'val1' });
        const el2 = createMockElement('div', { '--_sz-p': 'val2' });
        const usages: CSSVarUsage[] = [
            { element: el1, varName: '--_sz-p', valueExpr: t.stringLiteral('val1'), serializedValue: 'S:val1' },
            { element: el2, varName: '--_sz-p', valueExpr: t.stringLiteral('val2'), serializedValue: 'S:val2' },
        ];
        const parentMap = new Map<t.Node, t.Node>();

        hoistCSSVariables(usages, parentMap);
        // Both should keep their style since values differ
        for (const el of [el1, el2]) {
            const style = el.attributes.find(a =>
                t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'style',
            );
            expect(style).toBeDefined();
        }
    });
});

describe('buildParentMap', () => {
    it('should build parent relationships', () => {
        const inner = t.stringLiteral('hello');
        const outer = t.expressionStatement(inner);
        const program = t.program([outer]);

        const map = buildParentMap(program);
        expect(map.get(outer)).toBe(program);
        expect(map.get(inner)).toBe(outer);
    });

    it('should handle arrays of nodes', () => {
        const stmt1 = t.expressionStatement(t.stringLiteral('a'));
        const stmt2 = t.expressionStatement(t.stringLiteral('b'));
        const program = t.program([stmt1, stmt2]);

        const map = buildParentMap(program);
        expect(map.get(stmt1)).toBe(program);
        expect(map.get(stmt2)).toBe(program);
    });
});

// ===========================================================================
// G3 — Hoisting Edge Cases
// ===========================================================================

describe('hoistCSSVariables edge cases', () => {
    it('should NOT hoist when LCA is Fragment', () => {
        const el1 = createMockElement('div', { '--_sz-p': 'val1' });
        const el2 = createMockElement('div', { '--_sz-p': 'val1' });
        // Fragment ancestor cannot hold style attrs
        const fragment = t.jsxOpeningElement(t.jsxIdentifier('Fragment'), [], false);
        const usages: CSSVarUsage[] = [
            { element: el1, varName: '--_sz-p', valueExpr: t.stringLiteral('val1'), serializedValue: 'S:val1' },
            { element: el2, varName: '--_sz-p', valueExpr: t.stringLiteral('val1'), serializedValue: 'S:val1' },
        ];
        // Build parent map: both divs are children of Fragment
        const parentMap = new Map<t.Node, t.Node>();
        parentMap.set(el1, fragment);
        parentMap.set(el2, fragment);

        hoistCSSVariables(usages, parentMap);

        // Both should keep their styles since Fragment can't hold style
        for (const el of [el1, el2]) {
            const style = el.attributes.find(a =>
                t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'style',
            );
            expect(style).toBeDefined();
        }
    });

    it('should NOT hoist when same var has different values', () => {
        const el1 = createMockElement('div', { '--_sz-p': 'calc(4 * var(--spacing))' });
        const el2 = createMockElement('div', { '--_sz-p': 'calc(8 * var(--spacing))' });
        const usages: CSSVarUsage[] = [
            { element: el1, varName: '--_sz-p', valueExpr: t.stringLiteral('calc(4 * var(--spacing))'), serializedValue: 'S:calc(4 * var(--spacing))' },
            { element: el2, varName: '--_sz-p', valueExpr: t.stringLiteral('calc(8 * var(--spacing))'), serializedValue: 'S:calc(8 * var(--spacing))' },
        ];
        const parentMap = new Map<t.Node, t.Node>();

        hoistCSSVariables(usages, parentMap);

        // Both should keep their separate styles
        for (const el of [el1, el2]) {
            const style = el.attributes.find(a =>
                t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'style',
            );
            expect(style).toBeDefined();
        }
    });

    it('should not hoist single usage', () => {
        const el = createMockElement('div', { '--_sz-m': 'val' });
        const usages: CSSVarUsage[] = [
            { element: el, varName: '--_sz-m', valueExpr: t.stringLiteral('val'), serializedValue: 'S:val' },
        ];
        const parentMap = new Map<t.Node, t.Node>();

        hoistCSSVariables(usages, parentMap);

        const style = el.attributes.find(a =>
            t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'style',
        );
        expect(style).toBeDefined();
    });

    it('should skip all-dynamic usages (serializedValue null)', () => {
        const el1 = createMockElement('div', { '--_sz-bg': 'dyn' });
        const el2 = createMockElement('div', { '--_sz-bg': 'dyn' });
        const el3 = createMockElement('div', { '--_sz-bg': 'dyn' });
        const usages: CSSVarUsage[] = [
            { element: el1, varName: '--_sz-bg', valueExpr: t.identifier('x'), serializedValue: null },
            { element: el2, varName: '--_sz-bg', valueExpr: t.identifier('x'), serializedValue: null },
            { element: el3, varName: '--_sz-bg', valueExpr: t.identifier('x'), serializedValue: null },
        ];
        const parentMap = new Map<t.Node, t.Node>();

        hoistCSSVariables(usages, parentMap);

        // All should keep their styles
        for (const el of [el1, el2, el3]) {
            const style = el.attributes.find(a =>
                t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'style',
            );
            expect(style).toBeDefined();
        }
    });

    it('should handle empty usages array', () => {
        const parentMap = new Map<t.Node, t.Node>();
        // Should not throw
        expect(() => hoistCSSVariables([], parentMap)).not.toThrow();
    });

    it('should handle mixed static + dynamic for same var name', () => {
        const el1 = createMockElement('div', { '--_sz-p': 'static-val' });
        const el2 = createMockElement('div', { '--_sz-p': 'dynamic' });
        const usages: CSSVarUsage[] = [
            { element: el1, varName: '--_sz-p', valueExpr: t.stringLiteral('static-val'), serializedValue: 'S:static-val' },
            { element: el2, varName: '--_sz-p', valueExpr: t.identifier('dynamicVar'), serializedValue: null },
        ];
        const parentMap = new Map<t.Node, t.Node>();

        hoistCSSVariables(usages, parentMap);

        // el1 should keep style (only 1 static in group), el2 should keep (dynamic)
        for (const el of [el1, el2]) {
            const style = el.attributes.find(a =>
                t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'style',
            );
            expect(style).toBeDefined();
        }
    });

    it('should handle two different var names independently', () => {
        const el1 = createMockElement('div', { '--_sz-p': 'val1' });
        const el2 = createMockElement('div', { '--_sz-m': 'val2' });
        const usages: CSSVarUsage[] = [
            { element: el1, varName: '--_sz-p', valueExpr: t.stringLiteral('val1'), serializedValue: 'S:val1' },
            { element: el2, varName: '--_sz-m', valueExpr: t.stringLiteral('val2'), serializedValue: 'S:val2' },
        ];
        const parentMap = new Map<t.Node, t.Node>();

        hoistCSSVariables(usages, parentMap);

        // Each has unique var name, so no hoisting possible
        for (const el of [el1, el2]) {
            const style = el.attributes.find(a =>
                t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'style',
            );
            expect(style).toBeDefined();
        }
    });
});

describe('buildParentMap edge cases', () => {
    it('should handle deeply nested AST', () => {
        const deepLiteral = t.stringLiteral('deep');
        const stmt = t.expressionStatement(
            t.callExpression(t.identifier('fn'), [deepLiteral]),
        );
        const program = t.program([stmt]);

        const map = buildParentMap(program);
        expect(map.get(deepLiteral)).toBeDefined();
        expect(map.get(stmt)).toBe(program);
    });

    it('should handle empty program', () => {
        const program = t.program([]);
        const map = buildParentMap(program);
        expect(map.size).toBeGreaterThanOrEqual(0);
    });

    it('should set root node parent as undefined (not in map)', () => {
        const program = t.program([]);
        const map = buildParentMap(program);
        expect(map.get(program)).toBeUndefined();
    });
});
