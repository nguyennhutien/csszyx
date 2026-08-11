/**
 * The generated szcn registration must exist because the BUILD ran, not
 * because some module happened to be recompiled.
 *
 * webpack keeps a persistent module cache. A rebuild can replay an already
 * transformed module — import of the generated registration included — without
 * running the transform that writes it. If anything removed the generated
 * directory in between, and a clean script that spares webpack's own cache is
 * enough, the build then fails to resolve a file for a module nobody touched.
 *
 * Found exactly that way: a full local CI mirror wipes `.csszyx` and keeps
 * `.next`, and the next build could not resolve the registration at all.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import webpack from 'webpack';

import { _resetThemeGroupsFileCache } from '../src/theme-groups-file.js';
import { unplugin as rawInstance, webpackPlugin } from '../src/unplugin.js';

const roots: string[] = [];

afterEach(() => {
    _resetThemeGroupsFileCache();
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A project whose stylesheet declares a token szcn groups by.
 *
 * @returns Absolute project root.
 */
function project(): string {
    // realpath: macOS `tmpdir()` is a symlink and the plugin resolves through it.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-wp-theme-')));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
        join(root, 'src/theme.css'),
        '@import "tailwindcss";\n@theme { --color-brand: #2dd597; }\n',
        'utf8',
    );
    return root;
}

/**
 * Run one compilation to completion.
 *
 * @param compiler - Configured webpack compiler.
 */
async function runOnce(compiler: webpack.Compiler): Promise<void> {
    await new Promise<void>(resolve => {
        compiler.run(() => {
            compiler.close(() => {
                resolve();
            });
        });
    });
}

describe('the webpack lane writes the theme-group registration up front', () => {
    it('creates it when the compiler starts, before any module is transformed', async () => {
        const root = project();
        const compiler = webpack({
            mode: 'production',
            context: root,
            entry: {},
            plugins: [webpackPlugin({ build: { cache: false }, production: { mangle: false } })],
        });

        // No module is compiled here at all — an entry-less run is the sharpest
        // form of "nothing was transformed", which is what a fully cached
        // rebuild amounts to for the module that carries the import.
        await runOnce(compiler);

        expect(existsSync(join(root, '.csszyx/theme-groups.mjs'))).toBe(true);
    }, 60_000);

    it('writes nothing when the project declares no groupable tokens', async () => {
        const root = project();
        writeFileSync(join(root, 'src/theme.css'), '@import "tailwindcss";\n', 'utf8');

        const compiler = webpack({
            mode: 'production',
            context: root,
            entry: {},
            plugins: [webpackPlugin({ build: { cache: false }, production: { mangle: false } })],
        });
        await runOnce(compiler);

        expect(existsSync(join(root, '.csszyx/theme-groups.mjs'))).toBe(false);
    }, 60_000);

    // webpack itself always fills a context in, but this hook is also handed
    // compilers the framework built — Next.js taps it with its own object, and
    // every access around here is written for one that carries less than a real
    // compiler does. Without somewhere to write, the registration silently does
    // not happen and the build fails later on an import nobody touched.
    it('writes it under the working directory for a compiler carrying no context', () => {
        const root = project();
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const plugin = rawInstance.raw(
            { build: { cache: false }, production: { mangle: false } },
            { framework: 'webpack' },
        ) as unknown as { webpack: (compiler: unknown) => void };

        plugin.webpack({
            options: { mode: 'production' },
            // A tap that runs its callback, which is what a compilation does.
            hooks: {
                beforeCompile: { tap: (_name: string, run: () => void) => run() },
                thisCompilation: { tap: () => undefined },
            },
        });

        expect(existsSync(join(root, '.csszyx/theme-groups.mjs'))).toBe(true);
    });
});
