/**
 * The root `<template>` of an SFC ends at the `</template>` that closes it, as
 * Vue's own parser reads it, not at the first one in the file. A nested `<template v-if>` or `<template #slot>`
 * closes before the root does, and a `</template>` written in a comment, an
 * attribute value, an interpolation or a `<script>` block closes nothing; a
 * root cut short at any of them left every later `sz` as written, with no
 * diagnostic.
 */
import { describe, expect, it } from 'vitest';

import { extractTemplate, preprocess } from '../src/index.js';

const PARSERS = ['rust', 'wasm'] as const;

describe.each(PARSERS)('the %s artifact', parser => {
    const run = (source: string) => preprocess(source, { parser });

    it('lowers sz after a nested <template v-if> closes', () => {
        const result = run(
            '<template><template v-if="ok"><b sz="{ p: 4 }" /></template><i sz="{ m: 2 }" /></template>',
        );
        expect(result.code).toBe(
            '<template><template v-if="ok"><b class="p-4" /></template><i class="m-2" /></template>',
        );
        expect(result.count).toBe(2);
    });

    it('lowers sz after a slot <template #header> inside a component', () => {
        const result = run(
            '<template><Card><template #header>Hi</template><p sz="{ p: 4 }" /></Card></template>',
        );
        expect(result.code).toBe(
            '<template><Card><template #header>Hi</template><p class="p-4" /></Card></template>',
        );
    });

    it('lowers sz after templates nested three deep', () => {
        const nested =
            '<template v-if="a"><template v-if="b"><template v-if="c">x</template></template></template>';
        const result = run(`<template>${nested}<i sz="{ m: 2 }" /></template>`);
        expect(result.code).toBe(`<template>${nested}<i class="m-2" /></template>`);
    });

    it('does not count a self-closing <template /> as an opening', () => {
        const result = run(
            '<template><Card><template #empty /></Card><i sz="{ m: 2 }" /></template><p sz="{ p: 4 }" />',
        );
        expect(result.code).toBe(
            '<template><Card><template #empty /></Card><i class="m-2" /></template><p sz="{ p: 4 }" />',
        );
    });

    it.each([
        ['a comment', '<!-- </template> -->'],
        ['a double-quoted attribute value', '<a title="</template>"></a>'],
        ['a single-quoted attribute value', "<a title='</template>'></a>"],
        ['an interpolation', "{{ '</template>' }}"],
        ['an interpolation with a less-than', '{{ a<b ? 1 : 2 }}'],
    ])('reads past a </template> in %s', (_name, inner) => {
        const result = run(`<template>${inner}<i sz="{ m: 2 }" /></template>`);
        expect(result.code).toBe(`<template>${inner}<i class="m-2" /></template>`);
    });

    it('finds the root template after a <script> that writes template tags in a string', () => {
        const script = "<script>const html = '<template></template>';</script>\n";
        const result = run(`${script}<template><i sz="{ m: 2 }" /></template>`);
        expect(result.code).toBe(`${script}<template><i class="m-2" /></template>`);
    });

    it('leaves sz after the root template as written', () => {
        const source = '<template><i sz="{ m: 2 }" /></template>\n<docs><p sz="{ p: 4 }" /></docs>';
        expect(run(source).code).toBe(
            '<template><i class="m-2" /></template>\n<docs><p sz="{ p: 4 }" /></docs>',
        );
    });
});

describe('extractTemplate', () => {
    it('spans the root template, nested templates included', () => {
        const source = '<template><template v-if="a">x</template>y</template>';
        expect(extractTemplate(source)).toEqual({
            content: '<template v-if="a">x</template>y',
            start: 10,
            end: 42,
        });
    });

    it('accepts whitespace and a slash-free end tag with spaces', () => {
        expect(extractTemplate('<template>\n<div>x</div>\n</template >')?.content).toBe(
            '\n<div>x</div>\n',
        );
    });

    it('ends a top-level block at its own end tag, not a longer name', () => {
        const source =
            "<script>'</scripts>'; '<template></template>'</script><template>b</template>";
        expect(extractTemplate(source)?.content).toBe('b');
    });

    it('leaves text-content sz whose quote closes after the template as written', () => {
        const source = '<template>a sz="{ p: 4 }</template>"';
        expect(preprocess(source)).toEqual({
            code: source,
            map: null,
            transformed: false,
            count: 0,
            diagnostics: [],
        });
    });

    it('skips top-level comments, end tags, stray text and processing instructions', () => {
        const source =
            '<!-- <template>a</template> --></stray> 1 < 2 <!doctype html><?xml?><template>b</template>';
        expect(extractTemplate(source)?.content).toBe('b');
    });

    it('reads a quote inside an attribute name as part of the name', () => {
        expect(extractTemplate(`<template><a don't>x</a></template>`)?.content).toBe(
            "<a don't>x</a>",
        );
    });
});
