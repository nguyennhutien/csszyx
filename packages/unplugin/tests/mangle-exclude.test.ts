import { describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

/**
 * `production.mangleExclude` lists class names the mangler must never produce as
 * a short token, so a mangled alias cannot collide with a literal class in
 * non-csszyx CSS (the hybrid-build hazard). Drives the plugin's hooks directly and
 * returns the finalized class→token map.
 *
 * @param exclude - names to reserve, or undefined for the default (none).
 * @returns the injected mangle map as a parsed object.
 */
async function mangleMapWith(exclude?: string[]): Promise<Record<string, string>> {
    const plugins = vitePlugin({ production: { mangle: true, mangleExclude: exclude } });
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

    const root = '/tmp/csszyx-mangle-exclude-fixture';
    await call('configResolved', { root, command: 'build' });
    // Enough distinct sz classes that the allocator reaches the low single-letter
    // tokens `z`, `y`, `x`, … where a literal `.x`/`.y` collision would happen.
    await call(
        'transform',
        'export const A = () => <div sz={{ p: 1, m: 2, w: 3, h: 4, gap: 5, inset: 0 }} />;',
        `${root}/src/A.tsx`,
    );
    await call('buildEnd');
    const out = await call('transformIndexHtml', '<html><head></head><body></body></html>');
    const html = typeof out === 'string' ? out : ((out as { html?: string })?.html ?? '');
    const match = html.match(/__CSSZYX_MANGLE_MAP__[^>]*>([^<]*)</);
    return match ? JSON.parse(match[1]) : {};
}

describe('production.mangleExclude reserves class names from the mangler', () => {
    it('uses x and y as tokens when nothing is excluded', async () => {
        const tokens = Object.values(await mangleMapWith(undefined));
        expect(tokens).toContain('x');
        expect(tokens).toContain('y');
    });

    it('never assigns an excluded name as a token', async () => {
        const map = await mangleMapWith(['x', 'y']);
        const tokens = Object.values(map);
        expect(tokens).not.toContain('x');
        expect(tokens).not.toContain('y');
        // Every class still gets a unique token (no collision introduced by skipping).
        expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('still mangles every class — exclude only shifts which tokens are used', async () => {
        const baseline = await mangleMapWith(undefined);
        const excluded = await mangleMapWith(['x', 'y']);
        // Same classes mapped, same count — just reassigned around the reserved tokens.
        expect(Object.keys(excluded).sort()).toEqual(Object.keys(baseline).sort());
    });
});
