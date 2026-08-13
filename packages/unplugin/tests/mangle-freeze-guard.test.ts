/**
 * Guard rails around the frozen mangle map.
 *
 * The map is settled right after the prescan because a Vite build hashes a
 * stylesheet's filename while the module is still being transformed — so the
 * mangled bytes have to exist by then. Three things protect that contract:
 *
 *  1. a class discovered after the freeze fails the build, because the emitted
 *     CSS was already hashed against the map that did not have it;
 *  2. `vite build --watch` turns mangling off, because a rebuild cannot repeat
 *     the once-per-process prescan the frozen map is built from;
 *  3. webpack, which mangles after hashing and relies on `realContentHash` to
 *     recompute, says so when that option is switched off.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import webpack, { type WebpackPluginInstance } from 'webpack';

import {
    lateMangleCensusMessage,
    realContentHashDisabledMessage,
    vitePlugin,
    watchModeMangleMessage,
    webpackPlugin,
} from '../src/unplugin.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const PRESCANNED_SOURCE = 'export const App = () => <div sz={{ m: 3 }} />;';

type Hook = ((...args: unknown[]) => unknown) | undefined;

/** The vite plugin array with per-plugin hook access. */
interface Harness {
    root: string;
    hookOf: (pluginName: string, hookName: string) => Hook;
    configResolved: (config: Record<string, unknown>) => Promise<void>;
}

/**
 * Boot the vite plugin array against a fixture root holding one sz module.
 *
 * @param options csszyx plugin options.
 * @returns Hook access bound to one plugin instance.
 */
function boot(options = {}): Harness {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-freeze-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/App.tsx'), PRESCANNED_SOURCE, 'utf8');
    const plugins = vitePlugin({
        build: { parser: 'oxc', cache: false },
        ...options,
    }) as Array<Record<string, unknown>>;
    const hookOf = (pluginName: string, hookName: string): Hook => {
        const plugin = plugins.find(p => p?.name === pluginName);
        const hook = plugin?.[hookName];
        return (
            typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
        ) as Hook;
    };
    const ctx = { warn() {}, error() {} };
    return {
        root,
        hookOf,
        configResolved: async config => {
            for (const name of ['csszyx:pre', 'csszyx:css-mangle']) {
                await hookOf(name, 'configResolved')?.apply(ctx, [{ root, ...config }]);
            }
        },
    };
}

describe('a class discovered after the freeze fails the build', () => {
    it('names the late class and what to do about it', async () => {
        const h = boot({ production: { mangle: true } });
        await h.configResolved({ command: 'build' });

        // A module the prescan never walked: its sz classes reach the census
        // only now, after the stylesheet was already mangled and hashed.
        await h
            .hookOf('csszyx:pre', 'transform')
            ?.apply({ warn() {}, error() {} }, [
                'export const Late = () => <div sz={{ gap: 7 }} />;',
                join(h.root, 'src/Late.tsx'),
            ]);

        await expect(async () =>
            h.hookOf('csszyx:pre', 'buildEnd')?.apply({ warn() {}, error() {} }, []),
        ).rejects.toThrow('gap-7');
    });

    it('accepts a build whose census matches the prescan', async () => {
        const h = boot({ production: { mangle: true } });
        await h.configResolved({ command: 'build' });

        await h
            .hookOf('csszyx:pre', 'transform')
            ?.apply({ warn() {}, error() {} }, [PRESCANNED_SOURCE, join(h.root, 'src/App.tsx')]);

        await expect(async () =>
            h.hookOf('csszyx:pre', 'buildEnd')?.apply({ warn() {}, error() {} }, []),
        ).not.toThrow();
    });

    it('reports both halves of the census, and stays readable with neither', () => {
        expect(lateMangleCensusMessage(['gap-7'], ['legacy-card'])).toContain(
            'csszyx-owned classes: gap-7',
        );
        expect(lateMangleCensusMessage(['gap-7'], ['legacy-card'])).toContain(
            'author classes: legacy-card',
        );
        expect(lateMangleCensusMessage([], [])).toContain('the class census changed');
    });
});

describe('vite build --watch does not mangle', () => {
    it('turns mangling off and says why exactly once', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const h = boot({ production: { mangle: true } });

        await h.configResolved({ command: 'build', build: { watch: {} } });

        const notices = warn.mock.calls
            .map(args => args.map(String).join(' '))
            .filter(message => message.includes('disabled for this watch build'));
        expect(notices).toEqual([watchModeMangleMessage()]);

        // Mangling is off, so the stylesheet keeps its readable selectors and
        // the page's injected map is empty.
        const css = await h
            .hookOf('csszyx:css-mangle', 'transform')
            ?.apply({}, ['.m-3{margin:0.75rem}', join(h.root, 'style.css')]);
        expect(css).toBeFalsy();
    });
});

describe('webpack keeps its post-hash rewrite honest', () => {
    /**
     * Create a real webpack compiler with the plugin applied, without running a
     * compilation: the check under test happens when the plugin is applied.
     *
     * @param realContentHash Value for `optimization.realContentHash`.
     * @returns Warnings printed while the plugin was applied.
     */
    function applyPluginWith(realContentHash: boolean): string[] {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-realhash-'));
        tempDirs.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/index.js'), 'export const app = 1;\n', 'utf8');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        webpack({
            mode: 'production',
            context: root,
            entry: './src/index.js',
            optimization: { realContentHash },
            plugins: [
                webpackPlugin({
                    build: { cache: false },
                    production: { mangle: true },
                }) as WebpackPluginInstance,
            ],
        });
        return warn.mock.calls
            .map(args => args.map(String).join(' '))
            .filter(message => message.includes('realContentHash'));
    }

    it('warns when realContentHash is switched off while mangling', () => {
        expect(applyPluginWith(false)).toEqual([realContentHashDisabledMessage()]);
    });

    it('stays quiet on the default configuration', () => {
        expect(applyPluginWith(true)).toEqual([]);
    });
});
