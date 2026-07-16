import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

/**
 * Mangling is a production bundle-size optimization with no value in a dev server,
 * and it actively BREAKS a hybrid pipeline (a separate `@tailwindcss/vite` serves
 * UN-mangled CSS): `szr` would apply the runtime mangle map and emit class names
 * with no matching CSS, silently collapsing szv-driven layouts in `vite serve`.
 * So the dev server must inject an EMPTY mangle map regardless of config, while a
 * production build keeps the real map.
 *
 * @param command - the Vite command, `'serve'` (dev) or `'build'`.
 * @returns the JSON text of the injected `__CSSZYX_MANGLE_MAP__` script.
 */
async function injectedMangleMap(command: 'serve' | 'build'): Promise<string> {
    // mangle:true to prove `serve` overrides an explicit opt-in.
    const plugins = vitePlugin({ production: { mangle: true } });
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        if (!plugin) return undefined;
        const hook = (plugin as Record<string, unknown>)[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };

    const root = resolve(homedir(), '.cache/csszyx-tests/dev-mangle');
    await call('configResolved', { root, command });
    await call(
        'transform',
        'export const A = () => <div sz={{ p: 4, gap: 8 }} />;',
        `${root}/src/A.tsx`,
    );
    await call('buildEnd');
    const out = await call('transformIndexHtml', '<html><head></head><body></body></html>');
    const html = typeof out === 'string' ? out : ((out as { html?: string })?.html ?? '');
    const match = html.match(/__CSSZYX_MANGLE_MAP__[^>]*>([^<]*)</);
    return match ? match[1] : '{}';
}

describe('dev server never mangles (mangle map empty in serve)', () => {
    it('serve injects an EMPTY mangle map even when production.mangle is true', async () => {
        expect(await injectedMangleMap('serve')).toBe('{}');
    });

    it('build injects the real mangle map', async () => {
        const map = await injectedMangleMap('build');
        expect(map).not.toBe('{}');
        const parsed = JSON.parse(map) as Record<string, string>;
        // The sz classes the fixture emits are mangled in a real build.
        expect(typeof parsed['p-4']).toBe('string');
        expect(typeof parsed['gap-8']).toBe('string');
    });
});
