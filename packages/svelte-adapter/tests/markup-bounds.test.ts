/**
 * Only a real `<script>` or `<style>` element is code. The text `<script` or
 * `<style` written in a comment, a quoted attribute value or a `{ }`
 * expression opens nothing; taking it for a block hid every later `sz` from
 * the reader, which left it as written with no diagnostic.
 */
import { describe, expect, it } from 'vitest';

import { preprocess, transformMarkup } from '../src/index.js';

const PARSERS = ['rust', 'wasm'] as const;

describe.each(PARSERS)('the %s artifact', parser => {
    const run = (source: string) => preprocess(source, { parser });

    it.each([
        ['a comment', '<!-- <script> -->'],
        ['a double-quoted attribute value', '<a title="<script>"></a>'],
        ['a single-quoted attribute value', "<a title='<style>'></a>"],
        ['a text expression', '{"<style>"}'],
        ['a text expression with nested braces', "{fn({ a: '<script>' })}"],
        ['a template literal', '{`<style>${a}`}'],
        ['a string with an escaped quote', "{'it\\'s <script>'}"],
        ['an attribute expression', "<a title={'<script>'}></a>"],
        [
            'an attribute expression holding a greater-than',
            "<a title={a > b ? '<style>' : ''}></a>",
        ],
        ['a spread', "<a {...{ title: '<script>' }}></a>"],
        ['a block opening', "{#if a < b && c === '<script>'}x{/if}"],
    ])('lowers sz after <script or <style written in %s', (_name, inner) => {
        const result = run(`${inner}<i sz={{ m: 2 }}></i>`);
        expect(result.code).toBe(`${inner}<i class="m-2"></i>`);
        expect(result.diagnostics).toEqual([]);
    });

    it.each([
        ['a regex', "<p>{name.replace(/'/g, '')}</p>"],
        ['a regex holding a brace', "<p>{name.replace(/}/g, '')}</p>"],
        ['a block comment', "<p>{x /* don't */}</p>"],
        ['a line comment', "<p>{x // don't\n}</p>"],
        ['an attribute expression', "<button on:click={() => s.replace(/'/, '')}>b</button>"],
        ['a block opening', "{#if /'/.test(s)}x{/if}"],
    ])('lowers sz after an apostrophe in %s', (_name, inner) => {
        const result = run(`${inner}<i sz={{ m: 2 }}></i>`);
        expect(result.code).toBe(`${inner}<i class="m-2"></i>`);
        expect(result.diagnostics).toEqual([]);
    });

    it('lowers an sz value holding a comment with an apostrophe', () => {
        const result = run("<i sz={{ m: 2 /* it's */ }}></i>");
        expect(result.code).toBe('<i class="m-2"></i>');
        expect(result.diagnostics).toEqual([]);
    });

    it('still skips a real script block after a look-alike', () => {
        const source = '<!-- <style> --><script>let sz={ p: size };</script><i sz={{ m: 2 }}></i>';
        expect(run(source).code).toBe(
            '<!-- <style> --><script>let sz={ p: size };</script><i class="m-2"></i>',
        );
    });

    it('skips a script block nested in markup', () => {
        const source =
            '<svelte:head><script>let sz={ p: size };</script></svelte:head><i sz={{ m: 2 }}></i>';
        expect(run(source).code).toBe(
            '<svelte:head><script>let sz={ p: size };</script></svelte:head><i class="m-2"></i>',
        );
    });

    it('skips a style block whose rules hold braces', () => {
        const source = '<style>a { color: red; } b[sz={x}] {}</style><i sz={{ m: 2 }}></i>';
        expect(run(source).code).toBe(
            '<style>a { color: red; } b[sz={x}] {}</style><i class="m-2"></i>',
        );
    });

    it('ends a script block at its own end tag, not a longer name', () => {
        const source = "<script>'</scripts>'; let sz={ p: 1 };</script><i sz={{ m: 2 }}></i>";
        expect(run(source).code).toBe(
            '<script>\'</scripts>\'; let sz={ p: 1 };</script><i class="m-2"></i>',
        );
    });
});

describe('markup that never closes', () => {
    it.each([
        ['a comment', '<!-- x '],
        ['an attribute value', '<a title="x '],
        ['a text expression', '{a '],
        ['a string in a text expression', "{'a} "],
        ['an attribute expression', '<a title={a '],
        ['a script start tag', '<script lang="ts" '],
        ['a script block', '<script>a '],
        ['a script end tag', '<script>a</script x="'],
    ])('reports %s as the one error of the file', (_name, open) => {
        // Svelte cannot parse the file, and the build stops on it; nothing in
        // it is lowered and the error says where.
        const source = `<i sz={{ m: 2 }}></i>${open}<i sz={{ m: 2 }}></i>`;
        const result = transformMarkup(source);
        expect(result.code).toBe(source);
        expect(result.diagnostics.map(d => d.severity)).toEqual(['error']);
    });
});

describe('scan cost', () => {
    it('walks markup as deep as Svelte parses', () => {
        // Svelte's parser runs out of stack near 1,000 levels and fails the
        // compile there itself; the walk over its tree keeps its own stack.
        const depth = 500;
        const source = `${'<div>'.repeat(depth)}<i sz={{ m: 2 }}></i>${'</div>'.repeat(depth)}`;
        const startedAt = performance.now();
        expect(transformMarkup(source, { parser: 'wasm' }).code).toBe(
            source.replace('sz={{ m: 2 }}', 'class="m-2"'),
        );
        expect(performance.now() - startedAt).toBeLessThan(2_000);
    });

    it('reports every value only the runtime knows among many elements', () => {
        // No time bound: 68 ms here is 2.1 s on a CI runner testing every
        // package at once, and the cost is the engine batch's, not the reader's.
        const source = '<b sz={{ p: size }}></b>'.repeat(2_500);
        const result = transformMarkup(source, { parser: 'wasm' });
        expect(result.code).toBe(source);
        expect(result.diagnostics).toHaveLength(2_500);
    });
});
