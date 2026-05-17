/**
 * Grammar tokenization tests — verify the CSSzyx injection assigns the
 * expected scopes when combined with VS Code's real HTML grammar.
 *
 * Host scope = text.html.derivative (modern .html files). All assertions
 * check that at least one csszyx-custom scope is present on the interesting
 * tokens — that's the real contract (what themes match on).
 */

import { describe, expect, it } from 'vitest';

import { findToken, tokenizeLine } from './grammar-harness.js';

/**
 * Return true if the scope stack contains any scope with `substr` in its name.
 * @param stack - Scope stack returned by tokenizeLine.
 * @param substr - Substring to look for in any scope.
 * @returns True when at least one scope contains the substring.
 */
function hasScope(stack: string[], substr: string): boolean {
    return stack.some(s => s.includes(substr));
}

describe('sz attribute name', () => {
    it('gets the csszyx attribute-name scope in HTML (explicit object form)', async () => {
        const tokens = await tokenizeLine('<div sz="{ p: 4 }">');
        const sz = findToken(tokens, 'sz');
        expect(hasScope(sz.scopes, 'support.type.property-name.csszyx')).toBe(true);
    });

    it('gets the csszyx attribute-name scope in HTML (implicit form)', async () => {
        const tokens = await tokenizeLine('<div sz="p: 4">');
        const sz = findToken(tokens, 'sz');
        expect(hasScope(sz.scopes, 'support.type.property-name.csszyx')).toBe(true);
    });
});

describe('sz="..." attribute body — explicit form', () => {
    it('establishes the meta.attribute.sz scope across the value', async () => {
        const tokens = await tokenizeLine('<div sz="{ p: 4 }">');
        const inside = tokens.filter(
            t => 'p4:{ }'.includes(t.text.trim()) && t.text.trim().length > 0,
        );
        expect(inside.length).toBeGreaterThan(0);
        for (const t of inside) {
            expect(hasScope(t.scopes, 'meta.attribute.sz.html.csszyx')).toBe(true);
        }
    });

    it('assigns property-name scope to `bg`', async () => {
        const tokens = await tokenizeLine('<div sz="{ bg: \'red\' }">');
        const bg = findToken(tokens, 'bg');
        expect(hasScope(bg.scopes, 'support.type.property-name.csszyx')).toBe(true);
    });

    it("assigns string scope to quoted value 'red'", async () => {
        const tokens = await tokenizeLine('<div sz="{ bg: \'red\' }">');
        const redToken = tokens.find(t => t.text.includes('red'));
        expect(redToken).toBeDefined();
        if (!redToken) {
            return;
        }
        expect(hasScope(redToken.scopes, 'string.quoted.single.csszyx')).toBe(true);
    });

    it('assigns variant scope to `hover` when followed by {', async () => {
        const tokens = await tokenizeLine('<div sz="{ hover: { bg: \'red\' } }">');
        const hover = findToken(tokens, 'hover');
        expect(hasScope(hover.scopes, 'keyword.control.variant.csszyx')).toBe(true);
    });
});

describe('sz="..." attribute body — implicit form (no braces)', () => {
    it('assigns property-name scope to keys without outer braces', async () => {
        const tokens = await tokenizeLine('<div sz="bg: \'red\', p: 4">');
        const bg = findToken(tokens, 'bg');
        expect(hasScope(bg.scopes, 'support.type.property-name.csszyx')).toBe(true);
    });

    it('assigns number scope to unquoted numeric values', async () => {
        const tokens = await tokenizeLine('<div sz="p: 4">');
        const four = findToken(tokens, '4');
        expect(hasScope(four.scopes, 'constant.numeric.csszyx')).toBe(true);
    });
});
