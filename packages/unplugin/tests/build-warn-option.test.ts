/**
 * `build.warn` end to end through the bundler plugin (ADR 0011).
 *
 * The engines are tested directly elsewhere; what this file pins is the
 * plumbing — the option must reach the compiler options every lane receives,
 * and the observable bundler surface (the unresolvable-spread warning promoted
 * at buildEnd) must go quiet when the switch is off.
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { vitePlugin } from '../src/unplugin.js';

/** A module whose sz prop is an unresolvable spread — always a fallback. */
const SPREAD_SOURCE = 'export const A = ({o}) => <div sz={{ ...o, p: 4 }} />;\n';

/**
 * Drive the pre-plugin's hooks with a given build config.
 *
 * @param build - `build` options handed to the plugin.
 * @returns Hook caller and the fake project root.
 */
function harness(build: Record<string, unknown> = {}) {
    const plugins = vitePlugin({ build: { cache: false, ...build } });
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const call = async (hookName: string, ...args: unknown[]): Promise<unknown> => {
        for (const plugin of plugins) {
            if (!plugin || !(hookName in (plugin as Record<string, unknown>))) continue;
            const hook = (plugin as Record<string, unknown>)[hookName];
            const fn = (
                typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
            ) as ((...a: unknown[]) => unknown) | undefined;
            if (fn) await fn.apply(ctx, args);
        }
        return undefined;
    };
    const root = resolve(homedir(), '.cache/csszyx-tests/build-warn-option');
    return { call, root };
}

/**
 * Transform the spread module and flush buildEnd on a fresh harness.
 *
 * The spread promotion goes through `emitWarning`, which writes to
 * `console.warn` (the build log), not the bundler context — so that is the
 * channel to observe.
 *
 * @param build - `build` options handed to the plugin.
 * @returns console.warn lines recorded across the whole run.
 */
async function warningsFor(build: Record<string, unknown>): Promise<string[]> {
    const { call, root } = harness(build);
    const recorded: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        recorded.push(args.map(String).join(' '));
    });
    try {
        await call('configResolved', { root, command: 'build' });
        await call('transform', SPREAD_SOURCE, `${root}/src/a.tsx`);
        await call('buildEnd');
    } finally {
        spy.mockRestore();
    }
    return recorded;
}

describe('build.warn through the plugin', () => {
    it('promotes the unresolvable-spread warning by default', async () => {
        const warnings = await warningsFor({});
        expect(warnings.some(w => w.includes('unresolvable sz spread'))).toBe(true);
    });

    it('stays quiet with warn: false', async () => {
        const warnings = await warningsFor({ warn: false });
        expect(warnings.some(w => w.includes('unresolvable sz spread'))).toBe(false);
    });

    it('treats warn: true as the explicit default', async () => {
        const warnings = await warningsFor({ warn: true });
        expect(warnings.some(w => w.includes('unresolvable sz spread'))).toBe(true);
    });
});
