import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { callHooks } from './tailwind-project.js';

const platform = vi.hoisted(() => ({
    unsupported: false,
    missingMetadata: false,
    compilerMetadata: 'normal',
}));
vi.mock('@csszyx/core/native', async original => {
    const actual = await original<typeof import('@csszyx/core/native')>();
    return {
        ...actual,
        getNativePackageName: () => (platform.unsupported ? null : actual.getNativePackageName()),
    };
});
vi.mock('node:module', async original => {
    const actual = await original<typeof import('node:module')>();
    return {
        ...actual,
        createRequire: (url: string | URL) => {
            const require = actual.createRequire(url);
            if (!String(url).endsWith('/src/unplugin.ts')) return require;
            return Object.assign(
                (id: string) => {
                    if (id.startsWith('@csszyx/core-') && id.endsWith('/package.json')) {
                        if (platform.missingMetadata)
                            throw new Error('native package metadata disappeared');
                        return {};
                    }
                    return require(id);
                },
                require,
                {
                    resolve: (id: string) => {
                        if (id === '@csszyx/compiler') {
                            if (platform.compilerMetadata === 'unresolved')
                                throw new Error('compiler metadata unavailable');
                            if (platform.compilerMetadata === 'missing')
                                return '/csszyx-missing-package/entry.js';
                        }
                        return require.resolve(id);
                    },
                },
            );
        },
    };
});

afterEach(() => {
    platform.unsupported = false;
    platform.missingMetadata = false;
    platform.compilerMetadata = 'normal';
    vi.restoreAllMocks();
    vi.resetModules();
});

it.each(['unresolved', 'missing'])(
    'disables persistence when the compiler version is %s',
    async metadata => {
        platform.compilerMetadata = metadata;
        const root = mkdtempSync(join(tmpdir(), 'csszyx-version-unavailable-'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { vitePlugin } = await import('../src/unplugin.js');
            const hooks = callHooks(
                vitePlugin({ build: { cache: true, parser: 'wasm' } }) as never,
            );
            await hooks('configResolved', { root, command: 'build' });
            const transformed = (await hooks(
                'transform',
                'const App = () => <div sz={{ p: 4 }} />;',
                join(root, 'App.tsx'),
            )) as { code: string };
            expect(transformed.code).toContain('p-4');
            expect(warn.mock.calls.flat().join('\n')).toContain('transform-cache-disabled');
            expect(existsSync(join(root, '.csszyx/cache/transform'))).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    },
);

it('uses an unavailable identity on unsupported platforms', async () => {
    platform.unsupported = true;
    const { resolveNativeCacheIdentity } = await import('../src/unplugin.js');
    expect(resolveNativeCacheIdentity()).toBe('unavailable');
});

it('uses an unresolved identity when installed metadata cannot be read', async () => {
    platform.missingMetadata = true;
    const { resolveNativeCacheIdentity } = await import('../src/unplugin.js');
    expect(resolveNativeCacheIdentity()).toBe('unresolved');
});

it('still keys a native binary by its file identity without a package version', async () => {
    const { resolveNativeCacheIdentity } = await import('../src/unplugin.js');
    expect(resolveNativeCacheIdentity()).toMatch(/@0:\d+:\d+$/);
});
