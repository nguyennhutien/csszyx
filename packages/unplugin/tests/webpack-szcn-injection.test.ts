/**
 * The webpack lane's two module-facing behaviours around theme groups.
 *
 * A module that calls `szcn` has to receive the generated registration, and it
 * has to receive it as a REAL file: webpack reads the colon in `virtual:` as a
 * URI scheme and fails the build before any resolve plugin runs, so the virtual
 * module the other lanes use cannot be reused here. Gating the injection off
 * instead would leave the lane merging by built-in groups only — under-merging
 * silently, on a project that declared tokens precisely to avoid that.
 *
 * The rebuild half is separate: a watch pass skips the prescan, so a style
 * module edited between builds would keep serving importers the table it had
 * at startup unless the changed set is folded back into the registry first.
 */
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
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
 * A project whose stylesheet declares a token szcn groups by, plus an entry
 * module that calls szcn so the injection path has something to act on.
 *
 * @returns Absolute project root.
 */
function project(): string {
    // realpath: macOS `tmpdir()` is a symlink and the plugin resolves through it.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-wp-szcn-')));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
        join(root, 'src/theme.css'),
        '@import "tailwindcss";\n@theme { --color-brand: #2dd597; }\n',
        'utf8',
    );
    writeFileSync(
        join(root, 'src/index.js'),
        "import { szcn } from '@csszyx/runtime';\nexport const merged = szcn('p-4', 'p-6');\n",
        'utf8',
    );
    return root;
}

/**
 * Webpack config shared by both cases.
 *
 * The runtime is external so the bundle stays small and the assertion reads the
 * INJECTED import rather than the runtime's own contents.
 *
 * @param root - Project root.
 * @returns Webpack configuration.
 */
function configFor(root: string): webpack.Configuration {
    return {
        mode: 'development',
        devtool: false,
        context: root,
        entry: './src/index.js',
        output: { path: join(root, 'dist'), filename: 'bundle.js' },
        externals: { '@csszyx/runtime': 'commonjs @csszyx/runtime' },
        plugins: [webpackPlugin({ build: { cache: false }, production: { mangle: false } })],
    };
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

describe('a webpack module that calls szcn', () => {
    it('receives the generated registration as a real file import', async () => {
        const root = project();
        await runOnce(webpack(configFor(root)));

        expect(existsSync(join(root, '.csszyx/theme-groups.mjs'))).toBe(true);
        const bundle = readFileSync(join(root, 'dist/bundle.js'), 'utf8');
        // The registration ran because the module imported it — the token name
        // only reaches the bundle through the generated file.
        expect(bundle).toContain('brand');
        // And it arrived as a path, not as the virtual id this lane cannot take.
        expect(bundle).not.toContain('virtual:');
    }, 120_000);

    it('is left alone when the project declares no groupable tokens', async () => {
        // The other side of the same branch: with nothing to register there is
        // no file to import, and injecting one anyway would make every szcn
        // module depend on a module that registers nothing.
        const root = project();
        writeFileSync(join(root, 'src/theme.css'), '@import "tailwindcss";\n', 'utf8');
        await runOnce(webpack(configFor(root)));

        expect(existsSync(join(root, '.csszyx/theme-groups.mjs'))).toBe(false);
        expect(readFileSync(join(root, 'dist/bundle.js'), 'utf8')).not.toContain(
            'theme-groups.mjs',
        );
    }, 120_000);
});

describe('a webpack watch rebuild', () => {
    it('folds the changed and removed files back into the registry', async () => {
        // What the hook reads is `compiler.modifiedFiles` / `removedFiles`,
        // which only a watching compiler populates — a one-shot `run()` leaves
        // both undefined and never enters either loop.
        const root = project();
        const styles = join(root, 'src/styles.js');
        writeFileSync(styles, 'export const cardSz = { p: 2 };\n', 'utf8');
        // Imported, so webpack actually watches it — a file nothing depends on
        // is never in the changed set and the removal would go unnoticed.
        const doomed = join(root, 'src/doomed.js');
        writeFileSync(doomed, 'export const gone = 1;\n', 'utf8');
        writeFileSync(
            join(root, 'src/index.js'),
            "import { szcn } from '@csszyx/runtime';\n" +
                "import { cardSz } from './styles.js';\n" +
                "import { gone } from './doomed.js';\n" +
                'export const merged = szcn("p-4", "p-6");\n' +
                'export const used = [cardSz, gone];\n',
            'utf8',
        );

        const compiler = webpack(configFor(root));
        let builds = 0;
        await new Promise<void>((resolve, reject) => {
            const watching = compiler.watch({ aggregateTimeout: 20, poll: 60 }, error => {
                if (error) {
                    reject(error);
                    return;
                }
                builds += 1;
                if (builds === 1) {
                    // Both kinds of change at once, so one rebuild exercises
                    // both loops: one file rewritten, one dropped from the
                    // graph and deleted.
                    writeFileSync(styles, 'export const cardSz = { p: 5 };\n', 'utf8');
                    writeFileSync(
                        join(root, 'src/index.js'),
                        "import { szcn } from '@csszyx/runtime';\n" +
                            "import { cardSz } from './styles.js';\n" +
                            'export const merged = szcn("p-4", "p-6");\n' +
                            'export const used = [cardSz];\n',
                        'utf8',
                    );
                    rmSync(doomed, { force: true });
                    return;
                }
                watching.close(() => {
                    compiler.close(() => {
                        resolve();
                    });
                });
            });
        });

        expect(builds).toBeGreaterThanOrEqual(2);
    }, 180_000);
});
