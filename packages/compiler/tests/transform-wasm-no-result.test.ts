/**
 * A wasm artifact that answers a one-file batch with no result is reported as
 * unavailable, on the rendering transform and the unrendered one alike.
 *
 * Only a broken artifact can do it, so the artifact is replaced here: the
 * module loader hands the transform a wasm module whose batch answers `[]`.
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
                        ? { transform_batch_json: () => '[]' }
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
            expect.objectContaining({ code: 'internal-error', args: { where: 'transformWasm' } }),
        );
    });
});
