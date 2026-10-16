/**
 * The public preprocess() and Vite plugin wrappers, plus transformTemplate's
 * value-extraction and failure branches — the parts beyond the happy path the
 * existing suite already covers.
 */
import { describe, expect, it, vi } from 'vitest';

import { preprocess, transformTemplate, vitePlugin } from '../src/index.js';

type TransformFn = (code: string, id: string) => { code: string } | null;
const runTransform = (code: string, id: string, options = {}): { code: string } | null =>
    (vitePlugin(options).transform as unknown as TransformFn)(code, id);

describe('preprocess()', () => {
    it('returns the source untouched when there is no <template>', () => {
        const result = preprocess('<script>const x = 1;</script>');
        expect(result.transformed).toBe(false);
        expect(result.count).toBe(0);
    });

    it('transforms sz props inside a template', () => {
        const result = preprocess('<template><div :sz="{ p: 4 }" /></template>');
        expect(result.transformed).toBe(true);
        expect(result.code).not.toContain(':sz=');
    });

    it('reports no transform when the template has no real sz attribute', () => {
        const result = preprocess('<template><div data-sz="x" /></template>');
        expect(result.transformed).toBe(false);
    });
});

describe('vitePlugin()', () => {
    it('ignores non-vue files', () => {
        expect(runTransform('x', 'component.ts')).toBeNull();
    });

    it('skips vue files without sz props', () => {
        expect(runTransform('<template><div /></template>', 'A.vue')).toBeNull();
    });

    it('transforms vue files that use sz', () => {
        expect(
            runTransform('<template><div :sz="{ p: 4 }" /></template>', 'A.vue')?.code,
        ).toContain('class');
    });

    it('returns null when nothing transforms', () => {
        expect(runTransform('<template><div data-sz="x" /></template>', 'A.vue')).toBeNull();
    });
});

describe('transformTemplate branches', () => {
    it('lowers numbers, negatives, strings and nested variants', () => {
        const result = transformTemplate(
            `<div :sz="{ p: 4, m: -2, bg: 'red-500', hover: { p: 5 } }" />`,
        );
        expect(result.code).toBe('<div class="p-4 -m-2 bg-red-500 hover:p-5" />');
        expect(result.diagnostics).toEqual([]);
    });

    it('reports an unparseable sz object as an error without debug', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = transformTemplate('<div :sz="{ not valid js }" />');
        expect(result.code).toContain(':sz=');
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('transformTemplate and extract edges', () => {
    it('reports an array of numbers as an error', () => {
        const result = transformTemplate('<div :sz="[1, 2]" />');
        expect(result.count).toBe(0);
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
    });

    it('reports an unterminated sz object as an error', () => {
        const result = transformTemplate('<div :sz="{ p: 4 " />');
        expect(result.count).toBe(0);
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
    });

    it('reports a value whose quote closes after the template ends', () => {
        // The quoted value holds the `</template>`, as Vue reads it, so the
        // root template never closes and Vue cannot parse the file.
        const source = '<template><div :sz="{ p: 4 }</template>"';
        const result = preprocess(source);
        expect(result.code).toBe(source);
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
    });

    it('joins a transformed sz to an existing class attribute', () => {
        expect(transformTemplate('<div class="foo" :sz="{ p: 4 }" />').code).toBe(
            '<div class="foo p-4" />',
        );
    });

    it('returns the source when the template tag is never closed', () => {
        const result = preprocess('<template><div :sz="{ p: 4 }" />');
        expect(result.transformed).toBe(false);
    });
});

describe('transformTemplate and merge specifics', () => {
    it('logs a successful transform under debug', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        transformTemplate('<div :sz="{ p: 4 }" />', { debug: true });
        expect(log).toHaveBeenCalled();
        log.mockRestore();
    });

    it('ignores an sz attribute whose value is not quoted', () => {
        expect(transformTemplate('<div :sz=nope />').count).toBe(0);
    });
});

describe('class beside a bound class', () => {
    it.each([':class', 'v-bind:class'])(
        'writes its own class beside %s, which Vue joins',
        bound => {
            const result = preprocess(`<template><div ${bound}="dyn" :sz="{ p: 4 }" /></template>`);
            expect(result.code).toBe(`<template><div ${bound}="dyn" class="p-4" /></template>`);
        },
    );
});

describe('values only the runtime knows', () => {
    it('lowers a plain template string and refuses an interpolated one', () => {
        expect(transformTemplate('<div :sz="{ bg: `red-500` }" />').code).toBe(
            '<div class="bg-red-500" />',
        );
        expect(transformTemplate('<div :sz="{ bg: `has ${x}` }" />').count).toBe(0);
    });

    it.each(['{ ...rest }', '{ [k]: 1 }', '{ p: fn() }'])('refuses %s with an error', value => {
        const result = transformTemplate(`<div :sz="${value}" />`);
        expect(result.count).toBe(0);
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
    });

    it('lowers a spread of a literal object', () => {
        expect(transformTemplate('<div :sz="{ ...{ p: 4 } }" />').code).toBe('<div class="p-4" />');
    });
});
