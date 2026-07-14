/**
 * CsszyxCompiler's fail-open paths. The real WASM core never fails in this
 * environment, so mock it to prove an init failure and a transform throw both
 * fall back to the JavaScript path instead of crashing the build.
 */
import { describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({ initThrows: true, transformThrows: true }));
vi.mock('@csszyx/core', () => ({
    version: () => '0.0.0-mock',
    init: () => {
        if (control.initThrows) throw new Error('wasm init boom');
    },
    transform_sz: () => {
        if (control.transformThrows) throw new Error('wasm transform boom');
        return 'unused';
    },
}));

import { CsszyxCompiler } from '../src/compiler.js';

describe('CsszyxCompiler when the WASM core fails', () => {
    it('falls back to JS when init throws, and keeps transforming', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const compiler = CsszyxCompiler.getInstance();
        await compiler.init();
        expect(compiler.isWasmActive()).toBe(false);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('falling back to JavaScript'),
            expect.anything(),
        );
        expect(compiler.transform({ p: 4 })).toContain('p-4');
        warn.mockRestore();
    });

    it('produces the deterministic JS-fallback token when WASM is inactive', () => {
        const compiler = CsszyxCompiler.getInstance();
        const metadata = {
            component: 'Card',
            filePath: 'src/Card.tsx',
            line: 3,
            column: 7,
            mode: 'dev-only' as const,
            buildId: 'b1',
        };
        const token = compiler.generateRecoveryToken(metadata);
        expect(token).toBe('000004a68e6f');
        expect(compiler.generateRecoveryToken(metadata)).toBe(token);
    });

    it('preserves legacy recovery hashes for Unicode and unpaired surrogates', () => {
        const compiler = CsszyxCompiler.getInstance();
        expect(
            compiler.generateRecoveryToken({
                component: 'Café 🚀',
                filePath: 'src/组件/😀.tsx',
                line: 3,
                column: 7,
                mode: 'dev-only',
                buildId: 'b1',
            }),
        ).toBe('00002b1e62a9');
        expect(
            compiler.generateRecoveryToken({
                component: '\ud800',
                filePath: '\udc00',
                line: 0,
                column: 0,
                mode: 'csr',
                buildId: 'x',
            }),
        ).toBe('0000285bf788');
    });

    it('falls back to JS when an active WASM transform throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        control.initThrows = false;
        const compiler = CsszyxCompiler.getInstance();
        await compiler.init();
        expect(compiler.isWasmActive()).toBe(true);
        expect(compiler.transform({ p: 4 })).toContain('p-4');
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('WASM transformation failed'),
            expect.anything(),
        );
        warn.mockRestore();
    });
});
