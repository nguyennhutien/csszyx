/**
 * The one predicate every delivery lane consults, and the delivery resolver.
 *
 * Field report: a build with mangling OFF received an executable inline
 * installer carrying an empty map — refused by `script-src 'self'`, useful to
 * nobody. The truth table here is what keeps a lane from emitting an
 * installer for a map no runtime helper reads.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { needsRuntimeMangleRegistration } from '../src/mangle-delivery.js';
import { vitePlugin } from '../src/unplugin.js';
import { freshFixtureRoot } from './fixture-root.js';

describe('needsRuntimeMangleRegistration', () => {
    it.each([
        ['mangling off, empty map', false, {}, false],
        ['mangling off, class map present', false, { 'p-4': 'z' }, false],
        ['mangling on, empty map', true, {}, false],
        ['mangling on, class map present', true, { 'p-4': 'z' }, true],
    ])('%s → %s', (_label, enabled, map, expected) => {
        expect(needsRuntimeMangleRegistration(enabled, map)).toBe(expected);
    });

    it('is keyed on the CLASS map only — a variable-only build registers nothing', () => {
        // No runtime helper reads the variable map (lowerSz reads mangleMap,
        // szcn reads decode/mangleMap); it feeds the inert census and the
        // debug helpers. So it never justifies an installer on its own.
        expect(needsRuntimeMangleRegistration(true, {})).toBe(false);
    });
});

describe('the removed mangleMapDelivery option', () => {
    const removedWarnings = (warn: ReturnType<typeof vi.spyOn>): number =>
        warn.mock.calls.filter(call => String(call[0]).includes('mangleMapDelivery')).length;

    it('warns once that the option no longer exists, for any value', () => {
        for (const value of ['html', 'both', 'bundle', 'htlm']) {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            try {
                vitePlugin({ production: { mangleMapDelivery: value } as never });
                expect(removedWarnings(warn), value).toBe(1);
                expect(warn.mock.calls[0]?.[0]).toContain('has been removed');
            } finally {
                warn.mockRestore();
            }
        }
    });

    it('is silent when the option is absent', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            vitePlugin({ production: { mangle: true } });
            expect(removedWarnings(warn)).toBe(0);
        } finally {
            warn.mockRestore();
        }
    });
});

describe('census placeholder substitution', () => {
    it('fills the layout census from the final map, escaped for any quoting', async () => {
        // The census travels through the chunk as a placeholder because the map
        // is not final until the mangle passes have run. Output processing
        // substitutes it — and the payload has to survive whatever quoting a
        // minifier later picks for the string it sits in.
        const root = freshFixtureRoot('census-substitution');
        mkdirSync(resolve(root, 'src'), { recursive: true });
        writeFileSync(
            resolve(root, 'src/A.tsx'),
            'export const A = () => <div sz={{ p: 4 }} />;',
            'utf8',
        );
        const plugins = vitePlugin({ production: { mangle: true } }) as unknown as Record<
            string,
            unknown
        >[];
        const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
        const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
            const plugin = plugins.find(p => p && hookName in p);
            const hook = plugin?.[hookName];
            const fn = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as ((...a: unknown[]) => unknown) | undefined;
            return fn ? await fn.apply(ctx, args) : undefined;
        };
        await call('configResolved', { root, command: 'build' });
        const layout = (await call(
            'transform',
            'export default function RootLayout(){return <html lang="en"><body>x</body></html>;}',
            `${root}/app/layout.tsx`,
        )) as { code: string };
        expect(layout.code).toContain('___CSSZYX_CENSUS___');
        await call('buildEnd');

        const rendered = (await call('renderChunk', layout.code)) as { code: string } | null;
        const code = rendered?.code ?? layout.code;
        expect(code).not.toContain('___CSSZYX_CENSUS___');
        // Escaped, so no quote of the payload can close the literal it lands in.
        // Keys are plain class names here; `mangleVars` would namespace them.
        expect(code).toContain('\\u0022p-4\\u0022');
        for (const quote of ['"', "'", '`']) {
            const payload = code.slice(code.indexOf('__html'), code.indexOf('}}'));
            expect(payload.split(quote).length - 1, `bare ${quote} in payload`).toBeLessThan(3);
        }
    });
});
