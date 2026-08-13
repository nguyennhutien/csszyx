/**
 * Engine-artifact dispatch of `transformSource`.
 *
 * The selection is availability-only — never behaviour, which the parity
 * corpus gates — so the contract to pin is exactly the routing: native addon
 * when it loads, the wasm build when it does not. Which side a real host
 * exercises depends on the platform, so both are forced here through mocks;
 * without that, a CI runner with the native addon built never executes the
 * wasm side of the dispatch at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';
import { transformSource } from '../src/transform-select.js';
import { transformWasm } from '../src/transform-wasm.js';

vi.mock('../src/transform-rust.js', () => ({
    isRustTransformAvailable: vi.fn(),
    transformRust: vi.fn(() => ({ classes: new Set(['from-rust']) })),
}));

vi.mock('../src/transform-wasm.js', () => ({
    transformWasm: vi.fn(() => ({ classes: new Set(['from-wasm']) })),
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('transformSource artifact dispatch', () => {
    it('routes to the native addon when it is available', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(true);

        const result = transformSource('export const a = 1;', '/p/a.tsx', { rootDir: '/p' });

        expect(result.classes).toEqual(new Set(['from-rust']));
        expect(transformRust).toHaveBeenCalledWith('export const a = 1;', '/p/a.tsx', {
            rootDir: '/p',
        });
        expect(transformWasm).not.toHaveBeenCalled();
    });

    it('routes to the wasm build when the native addon cannot load', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(false);

        const result = transformSource('export const a = 1;', '/p/a.tsx', { rootDir: '/p' });

        expect(result.classes).toEqual(new Set(['from-wasm']));
        expect(transformWasm).toHaveBeenCalledWith('export const a = 1;', '/p/a.tsx', {
            rootDir: '/p',
        });
        expect(transformRust).not.toHaveBeenCalled();
    });
});
