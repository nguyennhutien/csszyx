/**
 * A wasm artifact that cannot load is reported as the wasm engine being
 * unavailable, with what loading it threw as the error's cause.
 *
 * Only a damaged install fails so, so the loader is replaced here: requiring
 * `@csszyx/core/parser-wasm` throws.
 */
import { describe, expect, it, vi } from 'vitest';

import { CsszyxError, isCsszyxError } from '../src/errors.js';

const loadFailure = vi.hoisted(() => new Error('Cannot find module csszyx_core_bg.wasm'));

vi.mock('node:module', async importOriginal => {
    const actual = await importOriginal<typeof import('node:module')>();
    return {
        ...actual,
        createRequire: (from: string | URL) => {
            const real = actual.createRequire(from);
            return Object.assign((id: string) => {
                if (id === '@csszyx/core/parser-wasm') throw loadFailure;
                return real(id);
            }, real);
        },
    };
});

const { transformWasm, WasmTransformUnavailableError } = await import('../src/transform-wasm.js');

describe('a wasm artifact that cannot load', () => {
    it('throws the unavailable error under its code, with the load failure as its cause', () => {
        let error: unknown;
        try {
            transformWasm('export const a = 1;', 'a.tsx');
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(WasmTransformUnavailableError);
        expect(error).toBeInstanceOf(CsszyxError);
        expect(isCsszyxError(error)).toBe(true);
        expect(error).toMatchObject({
            name: 'WasmTransformUnavailableError',
            message: `transformWasm: wasm engine unavailable - ${loadFailure.message}`,
            code: 'wasm-engine-unavailable',
            args: { detail: loadFailure.message },
        });
        expect((error as Error).cause).toBe(loadFailure);
    });
});
