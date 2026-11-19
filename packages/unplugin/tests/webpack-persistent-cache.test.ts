/**
 * webpack's persistent cache depends on csszyx itself.
 *
 * A module webpack restores from its filesystem cache is not transformed
 * again, so the cache must be thrown away when the code that transforms it
 * changes. Next.js keys its cache on its own version, `next.config` and the
 * keys of that config it reads, and on nothing of csszyx: measured on
 * Next 16.4.6, a csszyx whose output changed between two `next build
 * --webpack` runs sharing one cache (a fixed `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`,
 * which keeps the cache version stable) shipped the first run's classes.
 * The plugin adds its own files to `cache.buildDependencies`, so webpack
 * snapshots them with the cache: by package version under `node_modules`, by
 * content in a workspace.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { unplugin } from '../src/unplugin.js';
import { csszyxCacheDependencies, csszyxCacheVersion } from '../src/webpack-cache-dependencies.js';

type Cache =
    | { type: string; version?: string; buildDependencies?: Record<string, string[]> }
    | false
    | undefined;

/**
 * Apply the webpack lane to a compiler that carries `cache` and nothing else.
 *
 * @param cache - The compiler's cache option.
 * @returns The cache option after the plugin applied.
 */
function applyWith(cache: Cache): Cache {
    const plugins = [
        unplugin.raw({ build: { cache: false }, production: { mangle: false } }, {
            framework: 'webpack',
        } as never),
    ].flat() as Array<{ webpack?: (compiler: unknown) => void }>;
    const compiler = {
        context: process.cwd(),
        options: { mode: 'production', cache },
        hooks: {
            beforeCompile: { tap: () => undefined, tapPromise: () => undefined },
            thisCompilation: { tap: () => undefined },
        },
    };
    plugins.find(plugin => plugin.webpack)?.webpack?.(compiler);
    return compiler.options.cache;
}

describe('the webpack persistent cache', () => {
    it('depends on the csszyx files that decide what a module becomes', () => {
        const cache = applyWith({
            type: 'filesystem',
            buildDependencies: { config: ['/p/next.config.mjs'] },
        });
        const dependencies = (cache as { buildDependencies: Record<string, string[]> })
            .buildDependencies;

        expect(dependencies.config).toEqual(['/p/next.config.mjs']);
        expect((cache as { version?: string }).version).toMatch(/^csszyx@\d.*\+compiler@\d/);
        expect(dependencies.csszyx).toContain(
            fileURLToPath(new URL('../src/unplugin.ts', import.meta.url)),
        );
        expect(dependencies.csszyx?.some(file => file.includes('compiler'))).toBe(true);
        expect(dependencies.csszyx?.some(file => file.endsWith('csszyx_core.js'))).toBe(true);
        expect(dependencies.csszyx?.some(file => file.endsWith('native/index.js'))).toBe(true);
        for (const file of dependencies.csszyx ?? []) expect(existsSync(file), file).toBe(true);
    });

    it('is left alone when it is not on the filesystem', () => {
        expect(applyWith({ type: 'memory' })).toEqual({ type: 'memory' });
        expect(applyWith(false)).toBe(false);
        expect(applyWith(undefined)).toBeUndefined();
    });
});

describe('the csszyx files the cache depends on', () => {
    it('leave out an entry that does not resolve', () => {
        const resolve = (specifier: string): string => {
            if (specifier === '@csszyx/core/native') throw new Error('not installed');
            return `/m/${specifier}.js`;
        };

        expect(csszyxCacheDependencies('/m/unplugin.mjs', resolve)).toEqual([
            '/m/unplugin.mjs',
            '/m/@csszyx/compiler.js',
            '/m/@csszyx/core.js',
        ]);
    });
});

describe('the cache version', () => {
    it('carries the csszyx versions after the one the cache had', () => {
        expect(csszyxCacheVersion('next|16.4.6', { plugin: '0.18.0', compiler: '0.18.0' })).toBe(
            'next|16.4.6|csszyx@0.18.0+compiler@0.18.0',
        );
        expect(csszyxCacheVersion(undefined, { plugin: '0.18.1', compiler: '0.18.0' })).toBe(
            'csszyx@0.18.1+compiler@0.18.0',
        );
    });
});
