/**
 * The vite `handleHotUpdate` theme-rescan branch: when `build.scanCss` is
 * configured and the changed file matches, the plugin re-parses the @theme
 * blocks and refreshes the generated theme-groups module.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];
const hookContext = { warn() {}, error() {} };

async function invokeHook(
    plugins: ReturnType<typeof vitePlugin>,
    hookName: string,
    ...args: unknown[]
): Promise<unknown> {
    const plugin = plugins.find(candidate =>
        Boolean(candidate && hookName in (candidate as Record<string, unknown>)),
    );
    if (!plugin) return undefined;
    const hook = (plugin as Record<string, unknown>)[hookName];
    const handler = (
        typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler
    ) as ((...hookArgs: unknown[]) => unknown) | undefined;
    return handler ? await handler.apply(hookContext, args) : undefined;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('vite theme scan on hot update', () => {
    it('re-runs the theme scan when a watched scanCss file changes', async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-theme-hmr-')));
        tempDirs.push(root);
        const themeCss = path.join(root, 'theme.css');
        fs.writeFileSync(themeCss, '@theme {\n  --color-brand: #123456;\n}\n', 'utf8');

        const plugins = vitePlugin({ build: { scanCss: ['theme.css'] } });

        await invokeHook(plugins, 'configResolved', { root, command: 'serve' });

        const server = {
            config: { root },
            watcher: { emit() {} },
            moduleGraph: { getModuleById: () => null, invalidateModule() {} },
        };
        // Changing the watched theme file triggers the theme rescan branch.
        await expect(
            invokeHook(plugins, 'handleHotUpdate', { file: themeCss, server, modules: [] }),
        ).resolves.not.toThrow();

        // The scan wrote the generated theme declaration file.
        expect(fs.existsSync(path.join(root, '.csszyx', 'theme.d.ts'))).toBe(true);
    });

    it('writes no theme declaration when scanCss matches no CSS files', async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-theme-empty-')));
        tempDirs.push(root);

        const plugins = vitePlugin({ build: { scanCss: ['does-not-exist.css'] } });
        await invokeHook(plugins, 'configResolved', { root, command: 'serve' });

        // No matching CSS → the scan returns early and never writes theme.d.ts.
        expect(fs.existsSync(path.join(root, '.csszyx', 'theme.d.ts'))).toBe(false);
    });
});
