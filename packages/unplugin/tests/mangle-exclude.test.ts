import { describe, expect, it } from 'vitest';

import { allocateMangleTokens, vitePlugin } from '../src/unplugin.js';
import { freshFixtureRoot } from './fixture-root.js';

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

    const root = freshFixtureRoot('mangle-exclude');
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

    it('is a no-op for names that can never be a token (a hyphen excludes them)', async () => {
        const baseline = await mangleMapWith(undefined);
        // Tokens are base62 with no `-`/`_`, so these can never be produced anyway.
        const excluded = await mangleMapWith(['main-body', 'some_name', 'a-very-long-name']);
        expect(excluded).toEqual(baseline);
    });

    it('treats an empty exclude list the same as no exclude', async () => {
        const baseline = await mangleMapWith(undefined);
        expect(await mangleMapWith([])).toEqual(baseline);
    });

    it('skips across tiers when every single-letter token is reserved', async () => {
        const allTier1 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        const tokens = Object.values(await mangleMapWith(allTier1));
        // No single-letter token may survive — allocation jumps to tier 2 (`z9`, …).
        expect(tokens.every(t => t.length >= 2)).toBe(true);
        expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('memoized token allocation matches a fresh allocation across tier boundaries', () => {
        // encode() is memoized by index across calls; a large census crosses
        // the tier-1→2→3 boundaries where the reversed Base62 encoder is most
        // likely to mis-map. The token per class must be identical whether the
        // index cache was cold or warm.
        const eligible = Array.from({ length: 3000 }, (_, i) => `c${i}`);
        const first = allocateMangleTokens(eligible, new Set());
        const second = allocateMangleTokens(eligible, new Set());
        expect(second).toEqual(first);
        // Bijective across the whole range, and tokens grow in length by tier.
        const tokens = Object.values(first);
        expect(new Set(tokens).size).toBe(tokens.length);
        expect(tokens[0]).toHaveLength(1); // tier 1
        expect((tokens.at(-1) as string).length).toBeGreaterThanOrEqual(2); // past tier 1
    });

    it('skipping a long forbidden run stays linear and bijective', () => {
        // Reserving every tier-1 token forces the allocator to advance the
        // token index through a long forbidden run before landing in tier 2+.
        // No class may be skipped, and no token may repeat.
        const eligible = Array.from({ length: 100 }, (_, i) => `k${i}`);
        const allTier1 = 'zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA'.split('');
        const map = allocateMangleTokens(eligible, new Set(allTier1));
        expect(Object.keys(map)).toHaveLength(eligible.length);
        const tokens = Object.values(map);
        expect(tokens.every(t => t.length >= 2)).toBe(true);
        expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('never emits a census class name as a token (key/token spaces disjoint)', () => {
        // A large census eventually reaches multi-letter tokens that can spell
        // a real class name ('flex'). If that name is itself censused, a map
        // key would double as another class's token and a runtime map lookup
        // could re-encode an already-mangled string. Reserving every census
        // name keeps one-lookup resolution sound: key ⇒ original, always.
        const eligible = ['flex', 'grow', 'p-4'];
        const map = allocateMangleTokens(eligible, new Set(['z', 'y', ...eligible]));
        expect(Object.keys(map).sort()).toEqual([...eligible].sort());
        const tokens = Object.values(map);
        expect(tokens).not.toContain('z');
        expect(tokens).not.toContain('y');
        for (const token of tokens) {
            expect(eligible, `token ${token} must not collide with a census name`).not.toContain(
                token,
            );
        }
        expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('produces an identical map on repeated finalize (consistency across hooks)', async () => {
        // The whole reason exclude lives in config (not a bundle-CSS scan) is that
        // the map MUST be identical at every finalizeMangleMap call site — HTML
        // injection vs CSS rewrite. Re-running the flow must yield the same map.
        const first = await mangleMapWith(['x', 'y', 'z']);
        const second = await mangleMapWith(['x', 'y', 'z']);
        expect(second).toEqual(first);
    });
});
