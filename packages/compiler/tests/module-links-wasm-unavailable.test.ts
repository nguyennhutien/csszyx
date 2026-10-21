/**
 * The wasm module-link and global-var usage scans on an install whose wasm
 * artifact cannot load.
 *
 * `@csszyx/core` ships the artifact, so a working install never takes this
 * path; the loader is made to fail the way a missing file fails.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:module', async importOriginal => {
    const actual = await importOriginal<typeof import('node:module')>();
    return {
        ...actual,
        createRequire: () => () => {
            throw new Error("Cannot find module '@csszyx/core/parser-wasm'");
        },
    };
});

describe('the wasm module-link scan without its artifact', () => {
    it('names the engine as unavailable and says why', async () => {
        const { scanModuleLinksWasm, WasmTransformUnavailableError } = await import(
            '../src/transform-wasm.js'
        );

        expect(() => scanModuleLinksWasm([{ filename: '/p/a.ts', source: '' }])).toThrow(
            WasmTransformUnavailableError,
        );
        expect(() => scanModuleLinksWasm([{ filename: '/p/a.ts', source: '' }])).toThrow(
            "  note: the loader reported: Cannot find module '@csszyx/core/parser-wasm'.\n",
        );
    });

    it('names the engine unavailable for the global-var usage scan too', async () => {
        const { scanGlobalVarUsagesWasm, WasmTransformUnavailableError } = await import(
            '../src/transform-wasm.js'
        );

        expect(() => scanGlobalVarUsagesWasm([{ filename: '/p/a.ts', source: '' }])).toThrow(
            WasmTransformUnavailableError,
        );
    });
});
