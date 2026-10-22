/**
 * The one-time banner for a DEFAULT `rust` build degrading to wasm.
 *
 * Degradation only happens when rust is merely the default — an explicit
 * choice keeps its loud-failure contract — and the host has no loadable
 * native addon. No real runner hits both banners and the degraded detail
 * string unless its platform happens to lack the addon, so the probe results
 * are forced here and the exact wording is pinned: that string is what a
 * field user pastes into an issue, and it must say the ENGINE did not change.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@csszyx/compiler/engine', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/engine')>();
    return {
        ...actual,
        isRustTransformAvailable: () => false,
        isWasmTransformAvailable: () => true,
    };
});

const { vitePlugin } = await import('../src/unplugin.js');

describe('default rust with no native addon', () => {
    it('announces the wasm degrade once, naming both artifacts', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const plugins = vitePlugin({ build: { cache: false } });
            const plugin = plugins.find(p => p && 'transform' in (p as Record<string, unknown>));
            const hook = (plugin as Record<string, unknown>).transform;
            const transform = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as (this: unknown, code: string, id: string) => unknown;

            // Any source-file transform announces; a module without sz keeps
            // the engine itself out of the assertion. The id must be one
            // `transformInclude` accepts — the vite adapter gates on it
            // before the hook body, and a rejected id never announces.
            transform.call({ warn() {} }, 'export const x = 1;', '/p/App.tsx');
            transform.call({ warn() {} }, 'export const x = 1;', '/p/App.tsx');

            // Once per process, not once per transform.
            expect(warn.mock.calls.map(call => call.join(' '))).toEqual([
                '[csszyx] native-engine-unavailable:\n' +
                    '  The native engine is not available here, so the default `rust` parser runs on the wasm engine.\n' +
                    "  help: reinstall without skipping optional dependencies to get the native engine, or set `build.parser: 'wasm'` to hide this line.\n" +
                    '  note: the wasm engine produces the same output; only parsing is slower.\n' +
                    '  docs: https://csszyx.com/e/native-engine-unavailable',
                '[csszyx] active-parser:\n' +
                    '  This build parses with the wasm engine in place of the default native engine.\n' +
                    '  docs: https://csszyx.com/e/active-parser',
            ]);
        } finally {
            warn.mockRestore();
        }
    });
});
