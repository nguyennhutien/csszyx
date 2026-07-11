/**
 * transformMarkup's parser branches: an unparseable object, a plain Svelte
 * expression (single brace), quotes/escapes that shield inner braces, and an
 * unterminated attribute.
 */
import { describe, expect, it, vi } from 'vitest';

import { transformMarkup } from '../src/index.js';

describe('transformMarkup parser edges', () => {
    it('leaves an unparseable sz object in place and warns under debug', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = transformMarkup('<div sz={{ not valid js here }} />', { debug: true });
        expect(result.code).toContain('sz={{');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('ignores a single-brace Svelte expression', () => {
        expect(transformMarkup('<div sz={someExpr} />', {}).count).toBe(0);
    });

    it('respects quotes and escapes that contain braces', () => {
        const result = transformMarkup(
            `<div sz={{ label: "a}b", note: 'c\\'d', tpl: \`x}y\` }} />`,
            {},
        );
        expect(result.count).toBe(1);
        expect(result.code).not.toContain('sz={{');
    });

    it('ignores an unterminated sz attribute', () => {
        expect(transformMarkup('<div sz={{ p: 4 ', {}).count).toBe(0);
    });
});

describe('transformMarkup value extraction', () => {
    it('extracts numbers, negatives, booleans, strings, arrays and nested objects', () => {
        const result = transformMarkup(
            `<div sz={{ p: 4, m: -2, on: true, name: "x", list: [1, -3, "a"], nested: { q: 5 } }} />`,
            {},
        );
        expect(result.count).toBe(1);
        expect(result.code).not.toContain('sz={{');
    });
});
