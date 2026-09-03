/**
 * `production.manglePreserve` keeps csszyx-owned classes under their own
 * names. Entries are strings: an exact name, or a name whose LAST character
 * is `*`, which keeps every class that starts with the rest. A `*` anywhere
 * else is literal — csszyx itself emits `*:p-4`, `**:m-2` and
 * `[&>*]:gap-1`, and none of those ends in `*`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileManglePreserve, manglePreserveNoMatchMessage } from '../src/mangle-preserve.js';
import { vitePlugin } from '../src/unplugin.js';
import { freshFixtureRoot } from './fixture-root.js';

describe('compileManglePreserve', () => {
    it('keeps an exact name and nothing else', () => {
        const keep = compileManglePreserve(['bg-tag-blue-bg']);
        expect(keep.test('bg-tag-blue-bg')).toBe(true);
        expect(keep.test('bg-tag-blue-bg-2')).toBe(false);
    });

    it('treats a trailing * as a prefix', () => {
        const keep = compileManglePreserve(['bg-tag-*']);
        expect(keep.test('bg-tag-blue-bg')).toBe(true);
        expect(keep.test('bg-tag-')).toBe(true);
        expect(keep.test('text-tag-blue-fg')).toBe(false);
    });

    it('reads a * anywhere else as a literal character', () => {
        const keep = compileManglePreserve(['*:p-4', '[&>*]:gap-1']);
        expect(keep.test('*:p-4')).toBe(true);
        expect(keep.test('hover:p-4')).toBe(false);
        expect(keep.test('[&>*]:gap-1')).toBe(true);
    });

    // A stylesheet matching `bg-tag` by text matches it under every variant, so
    // an entry naming the utility has to keep the variant forms too. Matching
    // the written name alone kept `bg-tag-blue-bg` and renamed
    // `dark:bg-tag-blue-bg`, leaving the rule half-broken and saying nothing:
    // the entry counts as used, so the no-match warning stays quiet.
    it('keeps a class under a variant, by prefix and by exact name', () => {
        const prefix = compileManglePreserve(['bg-tag-*']);
        expect(prefix.test('bg-tag-blue-bg')).toBe(true);
        expect(prefix.test('dark:bg-tag-blue-bg')).toBe(true);
        expect(prefix.test('md:hover:bg-tag-red-bg/30')).toBe(true);
        expect(prefix.test('dark:text-tag-blue-fg')).toBe(false);

        const exact = compileManglePreserve(['bg-tag-blue-bg']);
        expect(exact.test('dark:bg-tag-blue-bg')).toBe(true);
        expect(exact.test('dark:bg-tag-blue-bg-2')).toBe(false);
    });

    // A colon inside brackets belongs to the variant's parameter, not to the
    // boundary between variants and the utility.
    it('reads the utility past a bracketed variant parameter', () => {
        const keep = compileManglePreserve(['bg-tag-*']);
        expect(keep.test('supports-[display:grid]:bg-tag-blue-bg')).toBe(true);
        expect(keep.test('[&>*]:bg-tag-blue-bg')).toBe(true);
        expect(keep.test('supports-[display:grid]:text-tag-blue-fg')).toBe(false);
    });

    // An entry may still name one variant form and only that one.
    it('keeps a variant-qualified entry to its own variant', () => {
        const keep = compileManglePreserve(['dark:bg-tag-blue-bg']);
        expect(keep.test('dark:bg-tag-blue-bg')).toBe(true);
        expect(keep.test('bg-tag-blue-bg')).toBe(false);
        expect(keep.test('hover:bg-tag-blue-bg')).toBe(false);
    });

    // `unmatched` answers the same question as `test`, so a build whose only
    // form of a utility carries a variant must not be told its entry is a typo.
    it('does not call an entry unmatched when only a variant form exists', () => {
        const keep = compileManglePreserve(['bg-tag-*', 'text-tag-blue-fg']);
        expect(keep.unmatched(['dark:bg-tag-blue-bg', 'hover:text-tag-blue-fg'])).toEqual([]);
        expect(keep.unmatched(['p-4'])).toEqual(['bg-tag-*', 'text-tag-blue-fg']);
    });

    it('refuses a lone *, which would switch mangling off silently', () => {
        expect(() => compileManglePreserve(['*'])).toThrow(/manglePreserve/);
    });

    it('refuses entries that are not non-empty strings, naming what it got', () => {
        expect(() => compileManglePreserve([''])).toThrow(/manglePreserve\[0\].*empty string/);
        expect(() => compileManglePreserve([/x/ as unknown as string])).toThrow(
            /a RegExp \(\/x\/\)/,
        );
        expect(() => compileManglePreserve([5 as unknown as string])).toThrow(/number 5/);
        expect(() => compileManglePreserve([undefined as unknown as string])).toThrow(
            /undefined undefined/,
        );
    });

    it('lists the entries a census never matched', () => {
        const keep = compileManglePreserve(['bg-tag-*', 'bg-tags-*', 'p-5']);
        expect(keep.unmatched(['bg-tag-blue-bg', 'p-4'])).toEqual(['bg-tags-*', 'p-5']);
        expect(manglePreserveNoMatchMessage(['bg-tags-*'])).toContain('1 entry matched');
        expect(manglePreserveNoMatchMessage(['bg-tags-*', 'p-5'])).toContain('2 entries matched');
    });

    it('is a no-op when unset', () => {
        expect(compileManglePreserve(undefined).test('p-4')).toBe(false);
        expect(compileManglePreserve(undefined).unmatched(['p-4'])).toEqual([]);
    });
});

const MODULE_SOURCE =
    'export const A = () => <div sz={{ p: 1, m: 2, w: 3, h: 4, gap: 5, inset: 0 }} />;';

/**
 * Drive the Vite plugin hooks the way `mangle-exclude.test.ts` does and return
 * the injected map plus every warning the build printed.
 *
 * @param production - The `production` config to build with.
 * @returns The finalized class → token map and the warnings.
 */
async function buildWith(
    production: Record<string, unknown>,
): Promise<{ map: Record<string, string>; warnings: string[] }> {
    const warnings: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
    });
    try {
        const plugins = vitePlugin({ production: { mangle: true, ...production } });
        const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
        const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
            const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
            if (!plugin) return undefined;
            const hook = (plugin as Record<string, unknown>)[hookName];
            const fn = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as ((...a: unknown[]) => unknown) | undefined;
            return fn ? await fn.apply(ctx, args) : undefined;
        };
        const root = freshFixtureRoot('mangle-preserve');
        mkdirSync(`${root}/src`, { recursive: true });
        writeFileSync(`${root}/src/A.tsx`, MODULE_SOURCE, 'utf8');
        await call('configResolved', { root, command: 'build' });
        await call('transform', MODULE_SOURCE, `${root}/src/A.tsx`);
        await call('buildEnd');
        const out = await call('transformIndexHtml', '<html><head></head><body></body></html>');
        const html = typeof out === 'string' ? out : ((out as { html?: string })?.html ?? '');
        const match = html.match(/__CSSZYX_MANGLE_MAP__[^>]*>([^<]*)</);
        return { map: match ? JSON.parse(match[1]) : {}, warnings };
    } finally {
        spy.mockRestore();
    }
}

describe('production.manglePreserve in a build', () => {
    afterEach(() => vi.restoreAllMocks());

    it('leaves a preserved class out of the map on both sides', async () => {
        const { map } = await buildWith({ manglePreserve: ['p-1', 'gap-*'] });
        expect(Object.keys(map)).not.toContain('p-1');
        expect(Object.keys(map)).not.toContain('gap-5');
        expect(Object.keys(map)).toContain('m-2');
        // Still forbidden as a token: the name stays in the census.
        expect(Object.values(map)).not.toContain('p-1');
        expect(Object.values(map)).not.toContain('gap-5');
    });

    it('allocates the same map whatever the entry order', async () => {
        const a = await buildWith({ manglePreserve: ['p-1', 'gap-*'] });
        const b = await buildWith({ manglePreserve: ['gap-*', 'p-1'] });
        expect(a.map).toEqual(b.map);
    });

    it('warns once about an entry that matched no class', async () => {
        const { warnings } = await buildWith({ manglePreserve: ['p-1', 'bg-tags-*'] });
        const hits = warnings.filter(w => w.includes('manglePreserve') && w.includes('bg-tags-*'));
        expect(hits).toHaveLength(1);
        expect(hits[0]).not.toContain('p-1');
    });

    it('warns about a mangleExclude entry that can never be a token', async () => {
        const { warnings } = await buildWith({ mangleExclude: ['x', 'bg-tag-blue-bg'] });
        const hit = warnings.find(w => w.includes('mangleExclude'));
        expect(hit).toContain('bg-tag-blue-bg');
        expect(hit).toContain('manglePreserve');
        expect(hit).not.toContain("'x'");
    });
});
