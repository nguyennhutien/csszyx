import { describe, expect, it } from 'vitest';

import { extractTemplate, transformTemplate } from '../src/index.js';

describe('Vue template transform', () => {
    it('extracts and transforms static sz attributes', () => {
        const source =
            '<template><div :sz="{ p: 4 }" /><span v-bind:sz="{ m: 2 }" /><i sz="{ display: \'block\' }" /></template>';
        const template = extractTemplate(source);

        expect(template?.content).toContain(':sz=');
        expect(transformTemplate(template?.content ?? '')).toMatchObject({
            code: '<div class="p-4" /><span class="m-2" /><i class="block" />',
            count: 3,
            transformed: true,
            diagnostics: [],
            map: { version: 3 },
        });
    });

    it('leaves sz text that is not an attribute alone', () => {
        const source = '<div data-sz="{ p: 4 }" title="sz={ p: 4 }" />';

        expect(transformTemplate(source)).toEqual({
            code: source,
            count: 0,
            transformed: false,
            diagnostics: [],
            map: null,
        });
    });

    it('keeps dynamic and malformed values as written, with an error each', () => {
        const source = '<div :sz="dynamic" /><b :sz="{ fn() }" />';
        const result = transformTemplate(source);

        expect(result.code).toBe(source);
        expect(result.diagnostics.map(d => [d.severity, d.column])).toEqual([
            ['error', 11],
            ['error', 34],
        ]);
    });

    it('walks a template nested deeper than a recursive walk could', () => {
        // A walk that recursed per element exhausts Node's default call stack
        // near 5k levels (measured: 4,774); Vue's parser and the adapter's walk
        // both keep a stack of their own. Kept just past that: Vue's parser
        // grows superlinearly deeper down (15k levels took 13 s on CI).
        const depth = 6_000;
        const source = `${'<div>'.repeat(depth)}<i sz="{ m: 2 }" />${'</div>'.repeat(depth)}`;

        expect(transformTemplate(source, { parser: 'wasm' }).code).toBe(
            source.replace('sz="{ m: 2 }"', 'class="m-2"'),
        );
    });

    it('reports every unreadable value among many elements', () => {
        // No time bound: the cost is the engine batch's, which a CI runner
        // testing every package at once runs some thirty times slower.
        const source = '<b :sz="{ p: }" />'.repeat(2_500);

        const result = transformTemplate(source, { parser: 'wasm' });
        expect(result.code).toBe(source);
        expect(result.count).toBe(0);
        expect(result.diagnostics).toHaveLength(2_500);
        expect(result.diagnostics.every(d => d.severity === 'error')).toBe(true);
    });
});
