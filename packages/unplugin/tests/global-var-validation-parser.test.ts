/**
 * The out-of-band global-var scan runs on the artifact the build runs: a build
 * pinned to wasm, for a host where the native addon crashes when called, must
 * not load the addon for this one pass.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@csszyx/compiler/engine', async importOriginal => ({
    ...(await importOriginal<typeof import('@csszyx/compiler/engine')>()),
    scanGlobalVarUsages: vi.fn(() => []),
}));

const { scanGlobalVarUsages } = await import('@csszyx/compiler/engine');
const { createGlobalVarAliasValidationOptions, validateGlobalVarAliasInputs } = await import(
    '../src/global-var-validation.js'
);

describe('the global-var usage scan', () => {
    it('runs on the parser the build passes', () => {
        validateGlobalVarAliasInputs(
            createGlobalVarAliasValidationOptions({
                rootDir: '/repo',
                cssAssets: [{ fileName: 'app.css', source: ':root { --brand: red; }' }],
                sourceFiles: [{ filePath: '/repo/a.tsx', code: 'export {};' }],
                tokens: ['--brand'],
                parser: 'wasm',
            }),
        );

        expect(scanGlobalVarUsages).toHaveBeenCalledWith('export {};', '/repo/a.tsx', {
            tokens: ['--brand'],
            parser: 'wasm',
        });
    });
});
