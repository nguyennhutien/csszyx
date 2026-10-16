/**
 * A template literal without a substitution is a string written in backticks.
 *
 * ``{ p: `4` }`` holds the string `'4'` before any code runs, so the build
 * lowers it to the class `{ p: '4' }` gets — on both engine artifacts — and
 * that class is the one the runtime `transform` writes for the same value.
 * Every reader of an sz value takes the same view: an `sz` attribute, an `szs`
 * slot, an `szv` config the precompile qualifies, and the `szv` catalog it
 * falls back to. A template with a substitution is still a runtime value.
 */
import { describe, expect, it } from 'vitest';

import { type SzObject, transform } from '../src/index.js';

import { ENGINES, expectParity } from './engine-parity-harness.js';

const IMPORT = "import { szv, szr } from '@csszyx/runtime';\n";

describe('a no-substitution template literal in an sz attribute', () => {
    it.each<[string, SzObject]>([
        ['{ p: `4` }', { p: '4' }],
        ['{ hover: { bg: `red-500` } }', { hover: { bg: 'red-500' } }],
        ['{ p: 4, content: `x` }', { p: 4, content: 'x' }],
    ])('%s lowers to the class its quoted spelling gets at runtime', (sz, value) => {
        expectParity(sz, transform(value).className);
    });

    it('a template with a substitution stays a runtime value', () => {
        expectParity('{ p: `${n}` }', 'p-(--_sz-p)');
    });
});

describe('a no-substitution template literal in the other sz readers', () => {
    it.each(ENGINES)('an szs slot object reads it on %s', (_name, engine) => {
        const { code } = engine('export const A = () => <Card szs={{ header: { p: `4` } }} />;');
        expect(code).toContain('szsc={{ header: "p-4" }}');
    });

    it.each(ENGINES)('an szv config holding one precompiles on %s', (_name, engine) => {
        const { code } = engine(
            `${IMPORT}const card = szv({ base: { p: \`4\` }, variants: { tone: { red: { bg: 'red-500' } } } });\n` +
                "export const x = szr(card({ tone: 'red' }));\n",
        );
        expect(code).toContain('"p-4 bg-red-500"');
    });

    it.each(ENGINES)('the szv catalog collects it on %s', (_name, engine) => {
        const { classes } = engine(
            `${IMPORT}declare const dense: boolean;\n` +
                'export const card = szv({ base: { p: `4`, m: dense ? 2 : 4 } });\n',
        );
        expect([...(classes ?? [])].sort()).toEqual(['m-2', 'm-4', 'p-4']);
    });
});
