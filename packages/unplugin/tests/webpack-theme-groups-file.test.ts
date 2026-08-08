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

import { afterEach, describe, expect, it } from 'vitest';
import webpack from 'webpack';

import { _resetThemeGroupsFileCache } from '../src/theme-groups-file.js';
import { webpackPlugin } from '../src/unplugin.js';

const roots: string[] = [];

afterEach(() => {
    _resetThemeGroupsFileCache();
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
});
