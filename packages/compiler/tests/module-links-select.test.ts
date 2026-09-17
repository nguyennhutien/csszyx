/**
 * Engine-artifact dispatch of `scanModuleLinks`.
 *
 * Like `transformSource`, the choice is availability only; both artifacts
 * answer identically, which `module-links.test.ts` gates. A runner with the
 * native addon built never takes the wasm side, so both are forced here.
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
    scanModuleLinksWasm: vi.fn(() => [{ cssImports: ['from-wasm.css'], forwards: [] }]),
}));

const FILES = [{ filename: '/p/a.tsx', source: "import './a.css';" }];

beforeEach(() => {
    vi.clearAllMocks();
});

describe('scanModuleLinks artifact dispatch', () => {
    it('routes to the native addon when it is available', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(true);

        expect(scanModuleLinks(FILES)).toEqual([{ cssImports: ['from-rust.css'], forwards: [] }]);
        expect(scanModuleLinksRust).toHaveBeenCalledWith(FILES);
        expect(scanModuleLinksWasm).not.toHaveBeenCalled();
    });

    it('routes to the wasm build when the native addon cannot load', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(false);

        expect(scanModuleLinks(FILES)).toEqual([{ cssImports: ['from-wasm.css'], forwards: [] }]);
        expect(scanModuleLinksWasm).toHaveBeenCalledWith(FILES);
        expect(scanModuleLinksRust).not.toHaveBeenCalled();
    });
});
