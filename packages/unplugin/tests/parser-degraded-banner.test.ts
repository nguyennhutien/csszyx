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

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
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

            const warned = warn.mock.calls.map(call => call.join(' ')).join('\n');
            expect(warned).toContain('fell back to its wasm build');
            expect(warned).toContain(
                'active parser: wasm (degraded from default `rust`: same engine, wasm build)',
            );
            // Once per process, not once per transform.
            expect(
                warn.mock.calls.filter(call => call.join(' ').includes('active parser')),
            ).toHaveLength(1);
        } finally {
            warn.mockRestore();
        }
    });
});
