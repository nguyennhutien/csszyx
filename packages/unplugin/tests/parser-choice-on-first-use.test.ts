/**
 * The plugin picks its engine artifact when a build first needs it, not when
 * the module loads.
 *
 * The module builds a default instance with no options as it is imported, so
 * resolving the artifact in the factory probed the native engine before the
 * user's config was read. A stale native binary then threw
 * `engine-version-skew` from the import itself, and `build.parser: 'wasm'`,
 * which would never touch that binary, could not get past it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@csszyx/compiler/engine', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler/engine')>();
    return {
        ...actual,
        isRustTransformAvailable: () => {
            throw new actual.EngineVersionSkewError(
                '[csszyx] engine-version-skew: stale native binary',
            );
        },
    };
});

/**
 * Run the plugin's transform hook on one module.
 *
 * @param options - Plugin options.
 * @returns What the hook returned.
 */
async function transformWith(
    options: Parameters<typeof import('../src/unplugin.js').vitePlugin>[0],
): Promise<unknown> {
    const { vitePlugin } = await import('../src/unplugin.js');
    const plugins = vitePlugin(options);
    const plugin = plugins.find(p => p && 'transform' in (p as Record<string, unknown>));
    const hook = (plugin as Record<string, unknown>).transform;
    const transform = (
        typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
    ) as (this: unknown, code: string, id: string) => unknown;
    // A module without sz: the hook still settles the artifact and announces
    // it, and the engine itself stays out of the assertion.
    return transform.call({ warn() {} }, 'export const x = 1;', '/p/App.tsx');
}

describe('a stale native binary', () => {
    it('does not stop the module from loading', async () => {
        await expect(import('../src/unplugin.js')).resolves.toHaveProperty('vitePlugin');
    });

    it('is never probed by a build pinned to wasm', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await transformWith({ build: { parser: 'wasm', cache: false } });
            expect(warn.mock.calls.map(call => call.join(' ')).join('\n')).toContain(
                'active parser: wasm',
            );
        } finally {
            warn.mockRestore();
        }
    });

    it('still stops a build that would run on it', async () => {
        await expect(transformWith({ build: { cache: false } })).rejects.toThrow(
            'engine-version-skew',
        );
    });
});
