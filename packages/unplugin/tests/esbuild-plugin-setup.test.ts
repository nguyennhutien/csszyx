import type { PluginBuild } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';

import { esbuildPlugin } from '../src/unplugin.js';

describe('esbuildPlugin setup', () => {
    it('returns the setup of both phases for esbuild to wait on', async () => {
        // unplugin registers each phase's `onLoad` only after an `await`, and
        // esbuild waits for a plugin's setup only when it is handed the promise.
        const onLoad = vi.fn();
        const build = {
            initialOptions: {},
            onStart: vi.fn(),
            onEnd: vi.fn(),
            onResolve: vi.fn(),
            onLoad,
            onDispose: vi.fn(),
            resolve: vi.fn(),
            esbuild: {},
        } as unknown as PluginBuild;

        const setup = esbuildPlugin({ build: { cache: false } }).setup(build);
        const registeredBeforeSettling = onLoad.mock.calls.length;
        await setup;

        expect(setup).toBeInstanceOf(Promise);
        expect(onLoad.mock.calls.length).toBeGreaterThan(registeredBeforeSettling);
    });
});
