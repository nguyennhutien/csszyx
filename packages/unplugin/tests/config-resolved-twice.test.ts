/**
 * A host can resolve one plugin instance more than once. `astro build` does:
 * its content sync starts a Vite server on the user's plugins first
 * (`command: 'serve'`), then builds with the same objects (`command: 'build'`,
 * measured on Astro 7.4.7). What each resolution turns on or off has to follow
 * that resolution, or the first one decides the build: the dev-server guard
 * left mangling off and the plugin acting as a dev server for the build.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import webpack, { type Configuration } from 'webpack';
import { vitePlugin, webpackPlugin } from '../src/unplugin.js';
import {
    MANGLE_RUNTIME_VIRTUAL_ID,
    RESOLVED_UNSERVED_VIRTUAL_ID,
    UNSERVED_PLACEHOLDER,
} from '../src/virtual-modules.js';
import { freshFixtureRoot } from './fixture-root.js';

const HTML = '<html><head></head><body></body></html>';
const RUNTIME_CONSUMER = `import { szr } from '@csszyx/runtime';\nexport const c = szr({ p: 4 });\n`;

/**
 * Drive one plugin instance's hooks directly, on a root holding one `sz` file.
 *
 * @param name - Fixture root name.
 * @returns Hook caller and the root.
 */
function harness(name: string) {
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
    const root = freshFixtureRoot(name);
    mkdirSync(resolve(root, 'src'), { recursive: true });
    writeFileSync(resolve(root, 'src/A.tsx'), 'export const A = () => <div sz={{ p: 4 }} />;');
    return { call, root };
}

describe('one instance resolved for two commands', () => {
    it('mangles the build after a serve resolution, as `astro build` runs it', async () => {
        const { call, root } = harness('config-resolved-serve-then-build');
        await call('configResolved', { root, command: 'serve' });
        await call('configResolved', { root, command: 'build' });
        await call('buildEnd');

        const out = (await call('transformIndexHtml', HTML)) as { html?: string } | string;
        const html = typeof out === 'string' ? out : (out.html ?? '');
        expect(html).toContain('__CSSZYX_MANGLE_MAP__');
        expect(html).toMatch(/data-sz-checksum="[0-9a-f]{16}"/);
    }, 60_000);

    it('leaves the build hole in the unserved module after a serve resolution', async () => {
        const { call, root } = harness('config-resolved-unserved');
        await call('configResolved', { root, command: 'serve' });
        await call('configResolved', { root, command: 'build' });

        const module_ = (await call('load', RESOLVED_UNSERVED_VIRTUAL_ID)) as string;
        expect(module_).toContain(UNSERVED_PLACEHOLDER);
    }, 60_000);

    // Not a regression test for the latch (the old code passes it too): it
    // keeps a fix from swinging the other way, re-enabling mangling and never
    // turning it off for a dev server.
    it('does not mangle a dev server resolved after a build', async () => {
        const { call, root } = harness('config-resolved-build-then-serve');
        await call('configResolved', { root, command: 'build' });
        await call('configResolved', { root, command: 'serve' });

        const out = (await call('transform', RUNTIME_CONSUMER, `${root}/src/b.ts`)) as {
            code?: string;
        } | null;
        expect(out?.code ?? RUNTIME_CONSUMER).not.toContain(MANGLE_RUNTIME_VIRTUAL_ID);
    }, 60_000);
});

describe('one webpack plugin instance across two compilers', () => {
    /**
     * Build the fixture once with `mode`, on the given plugin instance.
     *
     * @param root - The fixture root.
     * @param mode - webpack mode.
     * @param plugin - The shared csszyx plugin instance.
     * @returns The emitted stylesheet.
     */
    async function build(
        root: string,
        mode: 'development' | 'production',
        plugin: webpack.WebpackPluginInstance,
    ): Promise<string> {
        const out = join(root, `dist-${mode}`);
        const config: Configuration = {
            mode,
            context: root,
            entry: './src/index.js',
            output: { path: out, filename: 'bundle.js', assetModuleFilename: '[name][ext]' },
            module: { rules: [{ test: /\.css$/, type: 'asset/resource' }] },
            // The registration entry imports the runtime; this fixture has no
            // `node_modules`, and the assertion is about the stylesheet.
            externals: [
                ({ request }, callback) =>
                    request?.startsWith('@csszyx/runtime')
                        ? callback(undefined, `commonjs ${request}`)
                        : callback(),
            ],
            plugins: [plugin],
        };
        await new Promise<void>((done, fail) => {
            webpack(config, (error, stats) => {
                if (error) return fail(error);
                if (stats?.hasErrors()) return fail(new Error(stats.toString('errors-only')));
                done();
            });
        });
        return readFileSync(join(out, 'style.css'), 'utf8');
    }

    it('mangles a production build after a development one', { timeout: 60_000 }, async () => {
        const { root } = harness('config-resolved-webpack');
        writeFileSync(resolve(root, 'src/index.js'), "import './style.css';\n");
        writeFileSync(resolve(root, 'src/style.css'), '.p-4 { padding: 1rem; }\n');
        const plugin = webpackPlugin({
            build: { cache: false },
            production: { mangle: true },
        }) as webpack.WebpackPluginInstance;

        expect(await build(root, 'development', plugin)).toContain('.p-4');
        expect(await build(root, 'production', plugin)).not.toContain('.p-4');
    });
});
