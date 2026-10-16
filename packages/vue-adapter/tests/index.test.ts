import { describe, expect, it } from 'vitest';

import { extractTemplate, transformTemplate } from '../src/index.js';

describe('Vue template transform', () => {
    it('extracts and transforms static sz attributes', () => {
        const source =
            '<template><div :sz="{ p: 4 }" /><span v-bind:sz="{ m: 2 }" /><i sz="{ display: \'block\' }" /></template>';
        const template = extractTemplate(source);

        expect(template?.content).toContain(':sz=');
        expect(transformTemplate(template?.content ?? '')).toEqual({
            code: '<div class="p-4" /><span class="m-2" /><i class="block" />',
            count: 3,
            transformed: true,
            diagnostics: [],
        });
    });

    it('leaves sz text that is not an attribute alone', () => {
        const source = '<div data-sz="{ p: 4 }" title="sz={ p: 4 }" />';

        expect(transformTemplate(source)).toEqual({
            code: source,
            count: 0,
            transformed: false,
            diagnostics: [],
        });
    });

    it('keeps dynamic and malformed values as written, with an error each', () => {
        const source = '<div :sz="dynamic" :sz="{ fn() }" />';
        const result = transformTemplate(source);

        expect(result.code).toBe(source);
        expect(result.diagnostics.map(d => [d.severity, d.column])).toEqual([
            ['error', 11],
            ['error', 29],
        ]);
    });

    it('handles repeated hostile template and attribute openings in linear time', () => {
        const source = `${'<template '.repeat(100_000)}${'sz="{{a '.repeat(100_000)}`;
        const startedAt = performance.now();

        expect(extractTemplate(source)).toBeNull();
        const result = transformTemplate(source);
        expect(result.code).toBe(source);
        expect(result.count).toBe(0);
        expect(result.diagnostics.every(d => d.severity === 'error')).toBe(true);
        expect(performance.now() - startedAt).toBeLessThan(2_000);
    });
});
