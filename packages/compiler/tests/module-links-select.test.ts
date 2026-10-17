/**
 * Engine-artifact dispatch of `scanModuleLinks`.
 *
 * The artifact `build.parser` (or `CSSZYX_PARSER`) names, else the native
 * addon when it loads; both artifacts answer identically, which
 * `module-links.test.ts` gates. A runner with the native addon built never
 * takes the wasm side, so both are forced here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scanModuleLinks } from '../src/module-links.js';
import { isRustTransformAvailable, scanModuleLinksRust } from '../src/transform-rust.js';
import { scanModuleLinksWasm } from '../src/transform-wasm.js';

vi.mock('../src/transform-rust.js', () => ({
    isRustTransformAvailable: vi.fn(),
    scanModuleLinksRust: vi.fn(() => [{ cssImports: ['from-rust.css'], forwards: [] }]),
}));

vi.mock('../src/transform-wasm.js', () => ({
    isWasmTransformAvailable: vi.fn(() => true),
    scanModuleLinksWasm: vi.fn(() => [{ cssImports: ['from-wasm.css'], forwards: [] }]),
}));

const FILES = [{ filename: '/p/a.tsx', source: "import './a.css';" }];
const QUERY = { registryEntries: true };

beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('scanModuleLinks artifact dispatch', () => {
    it('routes to the native addon when it is available', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(true);

        expect(scanModuleLinks(FILES, QUERY)).toEqual([
            { cssImports: ['from-rust.css'], forwards: [] },
        ]);
        expect(scanModuleLinksRust).toHaveBeenCalledWith(FILES, QUERY);
        expect(scanModuleLinksWasm).not.toHaveBeenCalled();
    });

    it('routes to the wasm build when the native addon cannot load', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(false);

        expect(scanModuleLinks(FILES, QUERY)).toEqual([
            { cssImports: ['from-wasm.css'], forwards: [] },
        ]);
        expect(scanModuleLinksWasm).toHaveBeenCalledWith(FILES, QUERY);
        expect(scanModuleLinksRust).not.toHaveBeenCalled();
    });

    it('runs on the artifact the build names, without probing the native addon', () => {
        // A stale native binary throws engine-version-skew from the probe; a
        // build pinned to wasm must never reach it.
        vi.mocked(isRustTransformAvailable).mockImplementation(() => {
            throw new Error('engine-version-skew');
        });

        expect(scanModuleLinks(FILES, QUERY, 'wasm')).toEqual([
            { cssImports: ['from-wasm.css'], forwards: [] },
        ]);
        expect(isRustTransformAvailable).not.toHaveBeenCalled();
    });

    it('follows CSSZYX_PARSER, as the transform does', () => {
        vi.stubEnv('CSSZYX_PARSER', 'wasm');
        vi.mocked(isRustTransformAvailable).mockReturnValue(true);

        expect(scanModuleLinks(FILES, QUERY)).toEqual([
            { cssImports: ['from-wasm.css'], forwards: [] },
        ]);
    });
});
