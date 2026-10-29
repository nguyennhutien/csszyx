/**
 * Engine-artifact dispatch of `transformSource`.
 *
 * The artifact `build.parser` (or `CSSZYX_PARSER`) names, else the native
 * addon when it loads and the wasm build when it does not, as
 * `scanModuleLinks` chooses. The choice is never behaviour, which the parity
 * corpus gates, so the contract to pin is exactly the routing. Which side a
 * real host exercises depends on the platform, so both are forced here
 * through mocks; without that, a CI runner with the native addon built never
 * executes the wasm side of the dispatch at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    isRustTransformAvailable,
    transformRust,
    transformRustUnrendered,
} from '../src/transform-rust.js';
import { transformSource, transformSourceUnrendered } from '../src/transform-select.js';
import { transformWasm, transformWasmUnrendered } from '../src/transform-wasm.js';

vi.mock('../src/transform-rust.js', () => ({
    isRustTransformAvailable: vi.fn(),
    transformRust: vi.fn(() => ({ classes: new Set(['from-rust']) })),
    transformRustUnrendered: vi.fn(() => ({ classes: new Set(['from-rust-unrendered']) })),
}));

vi.mock('../src/transform-wasm.js', () => ({
    isWasmTransformAvailable: vi.fn(() => true),
    transformWasm: vi.fn(() => ({ classes: new Set(['from-wasm']) })),
    transformWasmUnrendered: vi.fn(() => ({ classes: new Set(['from-wasm-unrendered']) })),
}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('transformSource artifact dispatch', () => {
    it('routes to the native addon when it is available', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(true);

        const result = transformSource('export const a = 1;', {
            filename: '/p/a.tsx',
            rootDir: '/p',
        });

        expect(result.classes).toEqual(new Set(['from-rust']));
        expect(transformRust).toHaveBeenCalledWith('export const a = 1;', {
            filename: '/p/a.tsx',
            rootDir: '/p',
        });
        expect(transformWasm).not.toHaveBeenCalled();
    });

    it('routes to the wasm build when the native addon cannot load', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(false);

        const result = transformSource('export const a = 1;', {
            filename: '/p/a.tsx',
            rootDir: '/p',
        });

        expect(result.classes).toEqual(new Set(['from-wasm']));
        expect(transformWasm).toHaveBeenCalledWith('export const a = 1;', {
            filename: '/p/a.tsx',
            rootDir: '/p',
        });
        expect(transformRust).not.toHaveBeenCalled();
    });
});

describe('transformSourceUnrendered artifact dispatch', () => {
    it('routes to the native addon when it is available', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(true);

        const result = transformSourceUnrendered('export const a = 1;', { filename: '/p/a.tsx' });

        expect(result.classes).toEqual(new Set(['from-rust-unrendered']));
        expect(transformWasmUnrendered).not.toHaveBeenCalled();
    });

    it('routes to the wasm build when the native addon cannot load', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(false);

        const result = transformSourceUnrendered('export const a = 1;', {
            filename: '/p/a.tsx',
            rootDir: '/p',
        });

        expect(result.classes).toEqual(new Set(['from-wasm-unrendered']));
        expect(transformWasmUnrendered).toHaveBeenCalledWith('export const a = 1;', {
            filename: '/p/a.tsx',
            rootDir: '/p',
        });
        expect(transformRustUnrendered).not.toHaveBeenCalled();
    });
});

describe.each([
    ['transformSource', transformSource, transformWasm, transformRust],
    [
        'transformSourceUnrendered',
        transformSourceUnrendered,
        transformWasmUnrendered,
        transformRustUnrendered,
    ],
] as const)('%s on the artifact the build names', (_name, run, wasm, rust) => {
    it('runs on wasm without probing the native addon, and passes the options on', () => {
        // A stale native binary throws engine-version-skew from the probe; a
        // build pinned to wasm must never reach it.
        vi.mocked(isRustTransformAvailable).mockImplementation(() => {
            throw new Error('engine-version-skew');
        });

        run('export const a = 1;', { filename: '/p/a.tsx', rootDir: '/p', parser: 'wasm' });

        expect(isRustTransformAvailable).not.toHaveBeenCalled();
        // Both artifacts read their options field by field and leave
        // `parser` alone, so it goes on with the rest rather than costing
        // the entries a copy of the object.
        expect(wasm).toHaveBeenCalledWith('export const a = 1;', {
            filename: '/p/a.tsx',
            rootDir: '/p',
            parser: 'wasm',
        });
        expect(rust).not.toHaveBeenCalled();
    });

    it('follows CSSZYX_PARSER over the native addon', () => {
        vi.stubEnv('CSSZYX_PARSER', 'wasm');
        vi.mocked(isRustTransformAvailable).mockReturnValue(true);

        run('export const a = 1;', { filename: '/p/a.tsx' });

        expect(wasm).toHaveBeenCalled();
        expect(rust).not.toHaveBeenCalled();
    });
});
