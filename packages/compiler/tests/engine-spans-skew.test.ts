/**
 * Spans text this compiler cannot read is reported as a csszyx bug on both
 * lanes, naming the decoder and what it found.
 *
 * Only an engine from another build writes another format, so both bindings
 * are replaced here: each answers with the spans of a format one past the
 * compiler's.
 */
import { describe, expect, it, vi } from 'vitest';

import { ENGINE_SPANS_FORMAT } from '../src/engine-spans.js';

/** The spans text of a format this compiler does not read. */
const FUTURE = `${ENGINE_SPANS_FORMAT + 1},0,0,0,0,`;

/** What the decoder says about it. */
const DETAIL = `the engine wrote its spans in format ${ENGINE_SPANS_FORMAT + 1}; this compiler reads format ${ENGINE_SPANS_FORMAT}`;

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: class extends Error {},
    getNativePackageName: () => null,
    scanGlobalVarUsages: () => [],
    scanModuleLinks: () => [],
    transformBatch: (files: unknown[]) =>
        files.map(() => ({
            code: '',
            map: null,
            classes: [],
            rawClassNames: [],
            spans: FUTURE,
            recoveryTokens: [],
            cssVariableMap: [],
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
                                          code: '',
                                          classes: [],
                                          raw_class_names: [],
                                          spans: FUTURE,
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

const { transformRust, RustTransformUnavailableError } = await import('../src/transform-rust.js');
const { transformWasm, WasmTransformUnavailableError } = await import('../src/transform-wasm.js');

describe('spans text in a format this compiler does not read', () => {
    it.each([
        ['native', transformRust, RustTransformUnavailableError],
        ['wasm', transformWasm, WasmTransformUnavailableError],
    ] as const)('is a csszyx bug on the %s lane', (_lane, transform, ErrorClass) => {
        let error: unknown;
        try {
            transform('export const a = 1;', 'a.tsx');
        } catch (thrown) {
            error = thrown;
        }

        expect(error).toBeInstanceOf(ErrorClass);
        expect(error).toMatchObject({
            code: 'internal-error',
            args: { where: 'decodeEngineSpans', detail: DETAIL },
        });
    });
});
