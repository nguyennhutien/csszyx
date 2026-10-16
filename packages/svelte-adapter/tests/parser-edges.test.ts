/**
 * transformMarkup's reader branches: an unparseable object, a plain Svelte
 * expression (single brace), quotes/escapes that shield inner braces, markup
 * Svelte cannot parse, and the quoted forms.
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

    it.each([
        ['an unterminated sz attribute', '<div sz={{ p: 4 '],
        ['an unterminated quoted value', '<div sz="{{ p: 4 '],
        ['an unterminated bound value outside any tag', 'sz={ p: 4 '],
    ])('reports %s as the one error of the file', (_name, source) => {
        const result = transformMarkup(source);
        expect(result.code).toBe(source);
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
    });

    it('reads a quoted object in double braces', () => {
        expect(transformMarkup('<div sz="{{ p: 4 }}" />').code).toBe('<div class="p-4" />');
    });

    it.each([
        ['double', '<div sz="{ p: 4 }" />'],
        ['single', `<div sz='{ p: 4 }' />`],
    ])('reports the %s-quoted single-brace shorthand Svelte cannot parse', (_name, source) => {
        const result = transformMarkup(source);
        expect(result.code).toBe(source);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain(
            'write a quoted sz object as an expression',
        );
    });

    it('leaves sz written as text at the start of the source as written', () => {
        const source = 'sz={{ p: 4 }}';
        expect(transformMarkup(source)).toMatchObject({ code: source, count: 0, diagnostics: [] });
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
