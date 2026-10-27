/**
 * Every single-file engine call takes its options in one object.
 *
 * The file name sat in a second position, optional beside an optional
 * options object, so reaching the options meant writing a name the call did
 * not need, and a call in the old shape would read a string as the options.
 * Each call refuses that shape and names itself.
 */
import { describe, expect, it } from 'vitest';
import {
    extractCrossModuleForwards,
    extractCrossModuleRegistryEntries,
    scanGlobalVarUsages,
    scanModuleLinks,
    transformRust,
    transformSource,
    transformWasm,
} from '../src/engine.js';
import {
    transformRustUnrendered,
    transformSourceUnrendered,
    transformWasmUnrendered,
} from '../src/internal.js';

const SOURCE = 'export const A = () => <p sz={{ p: 4 }} />;';

/** Each call, by the name its error gives, with the old positional shape. */
const CALLS: ReadonlyArray<readonly [string, (...args: unknown[]) => unknown, unknown[]]> = [
    ['transformSource', transformSource as never, [SOURCE, 'a.tsx']],
    ['transformRust', transformRust as never, [SOURCE, 'a.tsx']],
    ['transformWasm', transformWasm as never, [SOURCE, 'a.tsx']],
    ['transformSourceUnrendered', transformSourceUnrendered as never, [SOURCE, 'a.tsx']],
    ['transformRustUnrendered', transformRustUnrendered as never, [SOURCE, 'a.tsx']],
    ['transformWasmUnrendered', transformWasmUnrendered as never, [SOURCE, 'a.tsx']],
    ['scanGlobalVarUsages', scanGlobalVarUsages as never, [SOURCE, 'a.tsx', {}]],
    [
        'scanModuleLinks',
        scanModuleLinks as never,
        [[{ filename: 'a.tsx', source: SOURCE }], {}, 'wasm'],
    ],
    [
        'extractCrossModuleRegistryEntries',
        extractCrossModuleRegistryEntries as never,
        [SOURCE, 'a.tsx'],
    ],
    ['extractCrossModuleForwards', extractCrossModuleForwards as never, [SOURCE, 'a.tsx']],
];

describe.each(CALLS)('%s', (call, fn, positional) => {
    it('refuses the positional shape and names itself', () => {
        expect(() => fn(...positional)).toThrow(
            expect.objectContaining({
                code: 'options-object-required',
                args: { form: 'engine-call', call },
                message: expect.stringContaining(`\`${call}\` takes its options in one object`),
            }),
        );
    });

    it('refuses null where the options go', () => {
        expect(() => fn(positional[0], null)).toThrow(
            expect.objectContaining({ code: 'options-object-required' }),
        );
    });
});

describe('the cross-module extractors', () => {
    it.each([
        ['extractCrossModuleRegistryEntries', extractCrossModuleRegistryEntries],
        ['extractCrossModuleForwards', extractCrossModuleForwards],
    ] as const)('%s refuses options without a filename', (call, fn) => {
        expect(() => (fn as (...args: unknown[]) => unknown)(SOURCE, { parser: 'wasm' })).toThrow(
            expect.objectContaining({
                code: 'options-object-required',
                args: { form: 'engine-call', call },
            }),
        );
    });
});

describe('the engine entry', () => {
    it('exports the types its calls take and return', async () => {
        const source = await import('node:fs').then(fs =>
            fs.readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8'),
        );
        for (const name of [
            'TransformSourceOptions',
            'TransformSourceCodeOptions',
            'SourceTransformResult',
        ]) {
            expect(source, name).toMatch(new RegExp(`export type \\{[^}]*\\b${name}\\b`));
        }
    });
});

describe('the options object', () => {
    it('carries the file name into the transform', () => {
        const result = transformSource(SOURCE, { filename: 'Card.tsx' });
        expect(result.code).toContain('p-4');
    });

    it('carries the file name and the parser into a module-link read', () => {
        const [entry] = extractCrossModuleRegistryEntries('export const card = { p: 4 };', {
            filename: 'card.ts',
            parser: 'wasm',
        });
        expect(entry?.exportName).toBe('card');
        const [links] = scanModuleLinks(
            [{ filename: 'card.ts', source: 'export const card = { p: 4 };' }],
            { registryEntries: true, parser: 'wasm' },
        );
        expect(links?.registryEntries.map(e => e.exportName)).toEqual(['card']);
    });

    it('takes no options at all', () => {
        expect(transformSource(SOURCE).code).toContain('p-4');
        expect(scanModuleLinks([{ filename: 'a.tsx', source: SOURCE }])).toHaveLength(1);
        expect(scanGlobalVarUsages(SOURCE)).toEqual([]);
    });
});
