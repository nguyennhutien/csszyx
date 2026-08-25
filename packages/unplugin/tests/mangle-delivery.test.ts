/**
 * The one predicate every delivery lane consults, and the delivery resolver.
 *
 * Field report: a build with mangling OFF received an executable inline
 * installer carrying an empty map — refused by `script-src 'self'`, useful to
 * nobody. The truth table here is what keeps a lane from emitting an
 * installer for a map no runtime helper reads.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    isLegacyMangleMapDelivery,
    legacyMangleMapDeliveryMessage,
    needsRuntimeMangleRegistration,
    resolveMangleMapDelivery,
} from '../src/mangle-delivery.js';
import { rollupPlugin, vitePlugin } from '../src/unplugin.js';
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

describe('resolveMangleMapDelivery', () => {
    it('defaults to bundle: no inline installer, bundle module on', () => {
        expect(resolveMangleMapDelivery(undefined)).toEqual({
            mode: 'bundle',
            explicit: false,
            inlineInstaller: false,
            bundleModule: true,
        });
    });

    it.each([
        ['bundle', false, true],
        ['html', true, false],
        ['both', true, true],
    ] as const)('%s → inline %s, bundle %s', (mode, inline, bundle) => {
        const resolved = resolveMangleMapDelivery(mode);
        expect(resolved).toEqual({
            mode,
            explicit: true,
            inlineInstaller: inline,
            bundleModule: bundle,
        });
        expect(isLegacyMangleMapDelivery(resolved)).toBe(inline);
    });

    it('rejects an unknown value instead of reading it as a mode', () => {
        expect(() => resolveMangleMapDelivery('htlm')).toThrow(
            /mangleMapDelivery must be 'both', 'html' or 'bundle'; got "htlm"/,
        );
    });

    it('names the mode and the remedy in the deprecation message', () => {
        const message = legacyMangleMapDeliveryMessage('html');
        expect(message).toContain("'html'");
        expect(message).toContain("'bundle'");
        expect(message).toContain("script-src 'self'");
    });
});

/**
 * Drive one plugin instance's hooks directly.
 *
 * @param plugins - Plugin array from a factory.
 * @returns Hook caller.
 */
function hookCaller(plugins: unknown[]) {
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    return async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        if (!plugin) return undefined;
        const hook = (plugin as Record<string, unknown>)[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
}

describe('legacy delivery warning', () => {
    const legacyWarnings = (warn: ReturnType<typeof vi.spyOn>): number =>
        warn.mock.calls.filter(call => String(call[0]).includes('emits an executable inline'))
            .length;

    it('vite warns once per build for an explicit html mode', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const call = hookCaller(
                vitePlugin({ production: { mangle: true, mangleMapDelivery: 'html' } }),
            );
            const root = freshFixtureRoot('legacy-delivery-vite');
            await call('configResolved', { root, command: 'build' });
            await call('configResolved', { root, command: 'build' });
            expect(legacyWarnings(warn)).toBe(1);
        } finally {
            warn.mockRestore();
        }
    });

    it('rollup warns once for an explicit both mode', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const plugins = rollupPlugin({
                production: { mangle: true, mangleMapDelivery: 'both' },
            }) as unknown as { buildStart?: () => void }[];
            const plugin = plugins.find(p => typeof p.buildStart === 'function');
            plugin?.buildStart?.();
            plugin?.buildStart?.();
            expect(legacyWarnings(warn)).toBe(1);
        } finally {
            warn.mockRestore();
        }
    });

    it('stays silent for the default, for bundle, and when mangling is off', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const root = freshFixtureRoot('legacy-delivery-silent');
            for (const production of [
                { mangle: true },
                { mangle: true, mangleMapDelivery: 'bundle' as const },
                { mangle: false, mangleMapDelivery: 'html' as const },
            ]) {
                const call = hookCaller(vitePlugin({ production }));
                await call('configResolved', { root, command: 'build' });
            }
            expect(legacyWarnings(warn)).toBe(0);
        } finally {
            warn.mockRestore();
        }
    });
});
