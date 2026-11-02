/** Optional boundary fields default safely; one CSS variable may have several aliases. */
import { describe, expect, it, vi } from 'vitest';
import { ENGINE_SPANS_FORMAT } from '../src/engine-spans.js';

const state = vi.hoisted(() => ({
    aliases: undefined as Array<{ original: string; mangled: string }> | undefined,
}));
vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: class extends Error {},
    getNativePackageName: () => null,
    scanGlobalVarUsages: () => [],
    scanModuleLinks: () => [],
    transformBatch: (files: unknown[]) =>
        files.map(() => ({
            code: 'export const a = 1;',
            classes: [],
            rawClassNames: [],
            spans: `${ENGINE_SPANS_FORMAT},0,0,0,0,`,
            recoveryTokens: [],
            cssVariableMap: state.aliases,
            metadata: { transformed: false },
        })),
}));
vi.mock('node:module', async importOriginal => {
    const actual = await importOriginal<typeof import('node:module')>();
    return {
        ...actual,
        createRequire: (from: string | URL) => {
            const real = actual.createRequire(from);
            return Object.assign(
                (id: string) =>
                    id === '@csszyx/core/parser-wasm'
                        ? {
                              transform_batch_json: () =>
                                  JSON.stringify([
                                      {
                                          code: 'export const a = 1;',
                                          classes: [],
                                          raw_class_names: [],
                                          spans: `${ENGINE_SPANS_FORMAT},0,0,0,0,`,
                                          recovery_tokens: [],
                                          metadata: { transformed: false },
                                      },
                                  ]),
                          }
                        : real(id),
                real,
            );
        },
    };
});
const { transformRust } = await import('../src/transform-rust.js');
const { transformWasm } = await import('../src/transform-wasm.js');

describe('optional engine result fields', () => {
    it.each([
        ['native', transformRust],
        ['wasm', transformWasm],
    ] as const)(
        'defaults an omitted CSS variable map from %s to an empty map',
        (name, transform) => {
            state.aliases = undefined;
            const result = transform('export const a = 1;');
            expect(result.code).toBe('export const a = 1;');
            if (name === 'native')
                expect(result).toMatchObject({
                    usesSzvPick: false,
                    usesSzvPick1: false,
                    szPartArgsProvable: false,
                    usesSpacingVar: false,
                    usesUnitVar: false,
                    usesBoolClass: false,
                });
            expect([...result.cssVariableMap]).toEqual([]);
        },
    );
    it('keeps distinct aliases in encounter order and drops repeated aliases', () => {
        state.aliases = ['--a', '--b', '--c', '--b'].map(mangled => ({
            original: '--gap',
            mangled,
        }));
        expect([...transformRust('export const a = 1;').cssVariableMap]).toEqual([
            ['--gap', ['--a', '--b', '--c']],
        ]);
    });
});
