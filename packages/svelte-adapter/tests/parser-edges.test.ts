/**
 * transformMarkup's reader branches: an unparseable object, a plain Svelte
 * expression (single brace), quotes/escapes that shield inner braces, an
 * unterminated attribute, and the quoted forms.
 */
import { describe, expect, it, vi } from 'vitest';

import { transformMarkup } from '../src/index.js';

describe('transformMarkup parser edges', () => {
    it('reports an unparseable sz object as an error without debug', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = transformMarkup('<div sz={{ not valid js here }} />');
        expect(result.code).toContain('sz={{');
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('reports a single-brace expression the engine cannot resolve as an error', () => {
        const result = transformMarkup('<div sz={someExpr} />');
        expect(result.count).toBe(0);
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
    });

    it('respects quotes and escapes that contain braces', () => {
        const result = transformMarkup(`<div sz={{ content: 'a}b\\'c', p: 4 }} />`);
        expect(result.code).not.toContain('sz={{');
    });

    it('ignores an unterminated sz attribute', () => {
        expect(transformMarkup('<div sz={{ p: 4 ')).toEqual({
            code: '<div sz={{ p: 4 ',
            count: 0,
            diagnostics: [],
        });
    });

    it('ignores an unterminated quoted value', () => {
        expect(transformMarkup('<div sz="{ p: 4 ').count).toBe(0);
    });

    it.each([
        ['quoted', 'sz="{ p: 4 '],
        ['bound', 'sz={ p: 4 '],
    ])('ignores an unterminated %s value outside any tag', (_name, source) => {
        expect(transformMarkup(source)).toEqual({ code: source, count: 0, diagnostics: [] });
    });

    it.each([
        ['double braces', '<div sz="{{ p: 4 }}" />'],
        ['single braces', `<div sz='{ p: 4 }' />`],
    ])('reads a quoted object in %s', (_name, source) => {
        expect(transformMarkup(source).code).toBe('<div class="p-4" />');
    });

    it('reads an sz attribute at the very start of the source', () => {
        expect(transformMarkup('sz={{ p: 4 }}').code).toBe('class="p-4"');
    });

    it('reads a component whose name starts like a script or style tag', () => {
        expect(transformMarkup('<Scripted sz={{ p: 4 }} /><Styled sz={{ m: 2 }} />').code).toBe(
            '<Scripted class="p-4" /><Styled class="m-2" />',
        );
    });

    it('ignores a value that is neither quoted nor braced', () => {
        expect(transformMarkup('<div sz=p-4 />').count).toBe(0);
    });
});

describe('transformMarkup value lowering', () => {
    it('lowers numbers, negatives, strings and nested variants', () => {
        const result = transformMarkup(
            `<div sz={{ p: 4, m: -2, bg: "red-500", hover: { p: 5 } }} />`,
        );
        expect(result.code).toBe('<div class="p-4 -m-2 bg-red-500 hover:p-5" />');
    });
});
