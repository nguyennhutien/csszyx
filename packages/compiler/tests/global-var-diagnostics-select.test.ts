/**
 * Engine-artifact dispatch of `scanGlobalVarUsages`.
 *
 * The choice is availability only; both artifacts answer identically, which
 * the `global-var-diagnostics*` suites gate. A runner with the native addon
 * built never takes the wasm side, so both are forced here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scanGlobalVarUsages } from '../src/global-var-diagnostics.js';
import { isRustTransformAvailable, scanGlobalVarUsagesRust } from '../src/transform-rust.js';
import { scanGlobalVarUsagesWasm } from '../src/transform-wasm.js';

const usage = (from: string) => ({
    kind: 'jsx-style-key',
    name: '--x',
    location: { filePath: from, line: 1, column: 1 },
    message: from,
});

vi.mock('../src/transform-rust.js', () => ({
    isRustTransformAvailable: vi.fn(),
    scanGlobalVarUsagesRust: vi.fn(() => [[usage('rust')]]),
}));

vi.mock('../src/transform-wasm.js', () => ({
    scanGlobalVarUsagesWasm: vi.fn(() => [[usage('wasm')]]),
}));

const FILES = [{ filename: '/p/a.tsx', source: 'source' }];

beforeEach(() => {
    vi.clearAllMocks();
});

describe('scanGlobalVarUsages artifact dispatch', () => {
    it('routes to the native addon when it is available, tokens as a list', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(true);

        expect(
            scanGlobalVarUsages('source', '/p/a.tsx', { tokens: new Set(['--x', '--y']) }),
        ).toEqual([usage('rust')]);
        expect(scanGlobalVarUsagesRust).toHaveBeenCalledWith(FILES, { tokens: ['--x', '--y'] });
        expect(scanGlobalVarUsagesWasm).not.toHaveBeenCalled();
    });

    it('routes to the wasm build when the native addon cannot load, every token reported', () => {
        vi.mocked(isRustTransformAvailable).mockReturnValue(false);

        expect(scanGlobalVarUsages('source')).toEqual([usage('wasm')]);
        expect(scanGlobalVarUsagesWasm).toHaveBeenCalledWith(
            [{ filename: 'file.tsx', source: 'source' }],
            {},
        );
        expect(scanGlobalVarUsagesRust).not.toHaveBeenCalled();
    });
});
