/**
 * A watch rebuild on the lanes with no hot update notices a Tailwind prefix
 * that changed under it.
 *
 * `rollup -w`, `vite build --watch`, an esbuild context and rspack run the
 * build-start hook again for every rebuild, and reuse every module they
 * compiled that did not change. A stylesheet edit that changes the prefix
 * leaves those modules holding classes under the old one, and none of these
 * bundlers can be told to recompile them all, so the rebuild fails with an
 * error that says to restart: a green rebuild would ship classes that style
 * nothing.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { context } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { esbuildPlugin, rollupPlugin, vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const STOCK = '@import "tailwindcss";\n';
const PREFIXED = '@import "tailwindcss" prefix(tw);\n';
const OPTIONS = { build: { cache: false }, production: { mangle: false } };

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * A stock project the plugin reads from its working directory, as the lanes
 * with no config hook do.
 *
 * @param css - The stylesheet the project starts with.
 * @returns The root, and everything printed to `console.warn`.
 */
function project(css = STOCK): { root: string; warnings: string[] } {
    const root = tailwindProject('csszyx-watch-prefix-', {
        'src/index.css': css,
        'src/index.js': 'export const ready = true;\n',
    });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
    });
    return { root, warnings };
}

/**
 * The plugin's hooks, as a rollup watch session calls them.
 *
 * @returns A caller for one hook by name.
 */
function rollupSession(): (hookName: string, ...args: unknown[]) => Promise<unknown> {
    const plugins = [rollupPlugin(OPTIONS)].flat() as unknown as Record<string, unknown>[];
    return callHooks(plugins);
}

describe('a Tailwind prefix that changes during a rollup watch session', () => {
    it('fails the rebuild with an error that says to restart', async () => {
        const { root } = project();
        const call = rollupSession();
        await call('buildStart');

        writeFileSync(join(root, 'src/index.css'), PREFIXED);

        await expect(call('buildStart')).rejects.toThrow(
            'src/index.css changed the Tailwind prefix from no prefix to `tw`',
        );
    }, 60_000);

    it('keeps failing until the prefix is back, then rebuilds', async () => {
        const { root } = project();
        const call = rollupSession();
        await call('buildStart');
        writeFileSync(join(root, 'src/index.css'), PREFIXED);
        await expect(call('buildStart')).rejects.toThrow('help: stop the watch');

        // A rebuild no stylesheet caused still ships modules under the old prefix.
        await expect(call('buildStart')).rejects.toThrow('help: stop the watch');

        writeFileSync(join(root, 'src/index.css'), `${STOCK}/* back */\n`);
        await expect(call('buildStart')).resolves.toBeUndefined();
    }, 60_000);

    it('rebuilds quietly for a stylesheet edit that leaves the prefix alone', async () => {
        const { root, warnings } = project();
        const call = rollupSession();
        await call('buildStart');

        writeFileSync(join(root, 'src/index.css'), `${STOCK}.card { color: red; }\n`);

        await expect(call('buildStart')).resolves.toBeUndefined();
        expect(warnings.join('\n')).not.toContain('Tailwind prefix');
    }, 60_000);

    it('warns once and keeps the prefix it last read when an edit breaks the stylesheet', async () => {
        const { root, warnings } = project();
        const call = rollupSession();
        await call('buildStart');

        writeFileSync(join(root, 'src/index.css'), `${STOCK}@import "./gone.css";\n`);
        await expect(call('buildStart')).resolves.toBeUndefined();
        await expect(call('buildStart')).resolves.toBeUndefined();

        const kept = warnings.filter(line => line.includes('keeps the prefix it last read'));
        expect(kept).toHaveLength(1);
    }, 60_000);
});

describe('a prefixed stylesheet deleted during a rollup watch session', () => {
    it('fails the rebuild, since the modules it kept carry the prefix', async () => {
        const { root } = project(PREFIXED);
        const call = rollupSession();
        await call('buildStart');

        rmSync(join(root, 'src/index.css'));

        await expect(call('buildStart')).rejects.toThrow(
            'src/index.css changed the Tailwind prefix from `tw` to no prefix',
        );
    }, 60_000);
});

describe('a build that stopped on the stylesheets', () => {
    it('stops again when the build starts again, rather than lower with a prefix it rejected', async () => {
        const { root } = project(PREFIXED);
        writeFileSync(join(root, 'src/legacy.css'), STOCK);
        const call = rollupSession();

        await expect(call('buildStart')).rejects.toThrow('set different prefixes');
        await expect(call('buildStart')).rejects.toThrow('set different prefixes');
    }, 60_000);
});

describe('a Tailwind prefix that changes during a vite build --watch session', () => {
    it('fails the rebuild with an error that says to restart', async () => {
        const { root } = project();
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);
        await call('configResolved', { root, command: 'build', build: { watch: {} } });
        await call('buildStart');

        writeFileSync(join(root, 'src/index.css'), PREFIXED);

        await expect(call('buildStart')).rejects.toThrow('changed the Tailwind prefix');
    }, 60_000);
});

describe('a Tailwind prefix that changes between esbuild context rebuilds', () => {
    it('fails the rebuild with an error that says to restart', async () => {
        const { root } = project();
        const ctx = await context({
            absWorkingDir: root,
            entryPoints: [join(root, 'src/index.js')],
            bundle: true,
            write: false,
            logLevel: 'silent',
            plugins: [esbuildPlugin(OPTIONS)],
        });
        try {
            await ctx.rebuild();
            writeFileSync(join(root, 'src/index.css'), PREFIXED);

            await expect(ctx.rebuild()).rejects.toThrow('changed the Tailwind prefix');
        } finally {
            await ctx.dispose();
        }
    }, 60_000);
});
