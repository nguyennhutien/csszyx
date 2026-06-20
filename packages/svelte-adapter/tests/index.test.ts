import { describe, expect, it } from 'vitest';

import { transformMarkup } from '../src/index.js';

describe('Svelte markup transform', () => {
    it('transforms quoted and bound static sz objects', () => {
        const result = transformMarkup(
            '<div sz="{{ p: 4 }}"></div><span sz={{ m: 2, hover: { display: "block" } }} />',
        );

        expect(result.count).toBe(2);
        expect(result.code).toContain('class="p-4"');
        expect(result.code).toContain('class="m-2 hover:block"');
    });

    it('preserves malformed and non-attribute sz text', () => {
        const source = '<div data-sz="{{ p: 4 }}" sz={dynamic} title="sz={{ m: 2 }}" />';

        expect(transformMarkup(source)).toEqual({ code: source, count: 0 });
    });

    it('handles quoted braces inside bound objects', () => {
        const result = transformMarkup(`<div sz={{ content: "'}'", p: 4 }} />`);

        expect(result.count).toBe(1);
        expect(result.code).toContain('p-4');
    });

    it('processes repeated hostile openings in linear time', () => {
        const source = `<div ${'sz="{{a '.repeat(100_000)} />`;
        const startedAt = performance.now();
        const result = transformMarkup(source);

        expect(result.count).toBe(0);
        expect(result.code).toBe(source);
        expect(performance.now() - startedAt).toBeLessThan(2_000);
    });
});
