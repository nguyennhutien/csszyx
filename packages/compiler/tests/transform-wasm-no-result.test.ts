/**
 * A wasm artifact that answers a one-file batch with no result is reported as
 * unavailable, on the rendering transform and the unrendered one alike.
 *
 * Only a broken artifact can do it, so the artifact is replaced here: the
 * module loader hands the transform a wasm module whose batch answers `[]`,
 * or throws as the engine does when it refuses a batch.
 */
import { describe, expect, it, vi } from 'vitest';

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
                              // A string, as wasm-bindgen throws a Rust `JsValue::from_str`.
                              transform_batch_json: (files: string) => {
                                  if (files.includes('refused.tsx')) {
                                      throw 'missing field `source` at line 1 column 25';
                                  }
                                  return '[]';
                              },
                          }
                        : real(id),
                real,
            );
        },
    };
});

const { transformWasm, transformWasmUnrendered, WasmTransformUnavailableError } = await import(
    '../src/transform-wasm.js'
);

describe('a wasm batch that returns no result', () => {
    it.each([
        ['transformWasm', transformWasm],
        ['transformWasmUnrendered', transformWasmUnrendered],
    ])('makes %s throw the unavailable error', (_name, transform) => {
        expect(() => transform('export const a = 1;', 'a.tsx')).toThrow(
            new WasmTransformUnavailableError('wasm transform returned no result'),
        );
        // Only a broken artifact answers so: a csszyx bug, not a missing engine.
        expect(() => transform('export const a = 1;', 'a.tsx')).toThrow(
            expect.objectContaining({
                code: 'internal-error',
                args: { where: 'transformWasm', detail: 'wasm transform returned no result' },
            }),
        );
    });
});

describe('a wasm batch the engine refuses', () => {
    it.each([
        ['transformWasm', transformWasm],
        ['transformWasmUnrendered', transformWasmUnrendered],
    ])('makes %s throw a csszyx bug that carries the message', (_name, transform) => {
        let error: unknown;
        try {
            transform('export const a = 1;', 'refused.tsx');
        } catch (thrown) {
            error = thrown;
        }
        expect(error).toBeInstanceOf(WasmTransformUnavailableError);
        expect(error).toMatchObject({
            code: 'internal-error',
            args: {
                where: 'engine transform',
                detail: 'missing field `source` at line 1 column 25',
            },
            cause: 'missing field `source` at line 1 column 25',
        });
    });
});
