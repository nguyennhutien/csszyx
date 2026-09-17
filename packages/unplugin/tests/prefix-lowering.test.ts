/**
 * Every lane lowers `sz` with the prefix the project's Tailwind entry sets.
 *
 * `@import "tailwindcss" prefix(tw)` makes `tw:p-4` the served class and `p-4`
 * a class with no CSS. The engine can write the prefix, but only once the
 * build has read the stylesheet, and on every lane that read is asynchronous
 * while the transforms that need it are not. A lane that transforms first gets
 * classes that style nothing and a green build.
 *
 * So the stylesheet is read at the start of every lane, and the engine refuses
 * to run when a lane skipped that step: an unread prefix is a csszyx bug, and a
 * loud one is found in a test run rather than on a customer's page.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import webpack from 'webpack';

import { SAFELIST_FILE } from '../src/safelist-source.js';
import {
    esbuildPlugin,
    unplugin as rawInstance,
    rollupPlugin,
    vitePlugin,
    webpackPlugin,
} from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const APP = 'export const App = () => <div sz={{ p: 4 }} />;\n';
const PREFIXED = '@import "tailwindcss" prefix(tw);\n';
const OPTIONS = { build: { cache: false }, production: { mangle: false } };

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * A project with one component and the given entry stylesheet.
 *
 * @param css - The entry stylesheet's contents.
 * @returns Absolute project root.
 */
function project(css: string): string {
    return tailwindProject('csszyx-prefix-lowering-', {
        'src/theme.css': css,
        'src/App.tsx': APP,
        'src/index.js': 'export const ready = true;\n',
    });
}

/**
 * The classes a build wrote for Tailwind to scan.
 *
 * @param root - Project root.
 * @returns One class per entry.
 */
function safelistOf(root: string): string[] {
    return readFileSync(join(root, SAFELIST_FILE), 'utf8').split('\n');
}

describe('the vite lane', () => {
    it('lowers `sz` with the prefix and writes the prefixed safelist', async () => {
        const root = project(PREFIXED);
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', APP, join(root, 'src/App.tsx'))) as {
            code: string;
        };

        expect(result.code).toContain('tw:p-4');
        expect(result.code).not.toMatch(/["\s]p-4/);
        // The prescan lowers every source before the first transform; the
        // safelist it writes is what Tailwind scans for the classes to emit.
        expect(safelistOf(root)).toContain('tw:p-4');
        expect(safelistOf(root)).not.toContain('p-4');
    }, 60_000);

    it('lowers `sz` as before for a stock entry', async () => {
        const root = project('@import "tailwindcss";\n');
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', APP, join(root, 'src/App.tsx'))) as {
            code: string;
        };

        expect(result.code).toContain('p-4');
        expect(result.code).not.toContain('tw:');
    }, 60_000);
});

describe('the stylesheet facts a bundler build records', () => {
    // A lane with no bundler (jest) reads the prefix from this file instead of
    // compiling the stylesheets itself.
    it('writes them where the other lanes look', async () => {
        const root = project(PREFIXED);
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        await call('configResolved', { root, command: 'build' });

        const facts = JSON.parse(
            readFileSync(join(root, '.csszyx/cache/stylesheet-facts.json'), 'utf8'),
        ) as { facts: { prefix: string | null } };
        expect(facts.facts.prefix).toBe('tw');
    }, 60_000);

    it('writes them under the configured cache directory', async () => {
        const root = project(PREFIXED);
        const call = callHooks(
            vitePlugin({
                ...OPTIONS,
                build: { cache: false, cacheDir: 'tmp/csszyx' },
            }) as unknown as Record<string, unknown>[],
        );

        await call('configResolved', { root, command: 'build' });

        expect(existsSync(join(root, 'tmp/csszyx/stylesheet-facts.json'))).toBe(true);
    }, 60_000);

    it('still builds when they cannot be written', async () => {
        const root = project(PREFIXED);
        // A file where the directory belongs: nothing can be written under it.
        writeFileSync(join(root, '.csszyx'), 'not a directory', 'utf8');
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', APP, join(root, 'src/App.tsx'))) as {
            code: string;
        };

        expect(result.code).toContain('tw:p-4');
    }, 60_000);
});

describe('stylesheets that give no single prefix', () => {
    /**
     * A project whose app entry sets \`prefix(tw)\` beside a stray stylesheet that
     * sets none, which the build walk finds as well.
     *
     * @returns Absolute project root.
     */
    function mixedProject(): string {
        return tailwindProject('csszyx-prefix-mixed-', {
            'src/index.css': PREFIXED,
            'legacy/old.css': '@import "tailwindcss";\n',
            'src/App.tsx': APP,
        });
    }

    it('stops the build and names each entry', async () => {
        const root = mixedProject();
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        const message = await call('configResolved', { root, command: 'build' }).then(
            () => '',
            (error: Error) => error.message,
        );

        expect(message).toContain('set different prefixes');
        // In walk order, which is the filesystem's, so each line on its own.
        expect(message).toMatch(/src\/index\.css\s+prefix\(tw\)/);
        expect(message).toMatch(/legacy\/old\.css\s+no prefix/);
    }, 60_000);

    it('reads only the stylesheets `tailwindStylesheet` lists', async () => {
        const root = mixedProject();
        const call = callHooks(
            vitePlugin({ ...OPTIONS, tailwindStylesheet: 'src/index.css' }) as unknown as Record<
                string,
                unknown
            >[],
        );

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', APP, join(root, 'src/App.tsx'))) as {
            code: string;
        };

        expect(result.code).toContain('tw:p-4');
    }, 60_000);

    it('stops the build when `tailwindStylesheet` lists a file that is not there', async () => {
        const root = mixedProject();
        const call = callHooks(
            vitePlugin({ ...OPTIONS, tailwindStylesheet: ['src/gone.css'] }) as unknown as Record<
                string,
                unknown
            >[],
        );

        await expect(call('configResolved', { root, command: 'build' })).rejects.toThrow(
            /tailwindStylesheet[\s\S]*src\/gone\.css/,
        );
    }, 60_000);
});

describe('stylesheets that did not compile', () => {
    it('stops the build when one that reaches Tailwind is broken', async () => {
        const root = tailwindProject('csszyx-prefix-broken-', {
            'src/index.css': '@import "tailwindcss" prefix(tw);\n@import "./gone.css";\n',
            'src/App.tsx': APP,
        });
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        const message = await call('configResolved', { root, command: 'build' }).then(
            () => '',
            (error: Error) => error.message,
        );

        expect(message).toContain('did not compile');
        expect(message).toMatch(/src\/index\.css: /);
    }, 60_000);

    it('warns about a stray one that never reaches Tailwind, and builds', async () => {
        const root = tailwindProject('csszyx-prefix-stray-', {
            'src/index.css': PREFIXED,
            'legacy/old.css': '@import "./gone.css";\n.card { color: red; }\n',
            'src/App.tsx': APP,
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', APP, join(root, 'src/App.tsx'))) as {
            code: string;
        };

        expect(result.code).toContain('tw:p-4');
        expect(warn.mock.calls.map(args => args.join(' ')).join('\n')).toMatch(
            /never reached Tailwind[\s\S]*legacy\/old\.css: /,
        );
    }, 60_000);
});

describe('the lanes without a prescan', () => {
    it('rollup reads the prefix at build start', async () => {
        const root = project(PREFIXED);
        // The plugin takes its root from the working directory on this lane.
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const [pre] = rollupPlugin(OPTIONS) as unknown as Array<{
            buildStart: (this: unknown) => Promise<void>;
            transform: (this: unknown, code: string, id: string) => { code: string };
        }>;
        const ctx = { warn() {}, meta: {} };

        await pre?.buildStart.call(ctx);
        const result = pre?.transform.call(ctx, APP, join(root, 'src/App.tsx'));

        expect(result?.code).toContain('tw:p-4');
    }, 60_000);

    it('esbuild reads the prefix at build start', async () => {
        const root = project(PREFIXED);
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const output = await build({
            absWorkingDir: root,
            entryPoints: ['src/App.tsx'],
            write: false,
            bundle: false,
            jsx: 'preserve',
            logLevel: 'silent',
            plugins: [esbuildPlugin(OPTIONS)],
        });

        expect(output.outputFiles[0]?.text).toContain('tw:p-4');
    }, 60_000);
});

describe('the webpack lane', () => {
    it('reads the prefix before the prescan lowers anything', async () => {
        const root = project(PREFIXED);
        const compiler = webpack({
            mode: 'production',
            devtool: false,
            context: root,
            entry: './src/index.js',
            output: { path: join(root, 'dist'), filename: 'bundle.js' },
            optimization: { minimize: false },
            externals: [
                ({ request }, callback) =>
                    request?.startsWith('@csszyx/runtime')
                        ? callback(undefined, `commonjs ${request}`)
                        : callback(),
            ],
            plugins: [webpackPlugin(OPTIONS)],
        });

        await new Promise<void>((res, rej) => {
            compiler.run((error, stats) => {
                compiler.close(() => {
                    if (error) rej(error);
                    else if (stats?.hasErrors()) rej(new Error(stats.toString('errors-only')));
                    else res();
                });
            });
        });

        // The prescan walked `App.tsx` although the entry never imports it.
        expect(safelistOf(root)).toContain('tw:p-4');
        expect(safelistOf(root)).not.toContain('p-4');
    }, 60_000);
});

describe('an unserved-class list asked for before the stylesheet was read', () => {
    // An empty list would read as "Tailwind serves every class", and each name
    // would silently keep a placement it should not: the same lane bug the
    // engine refuses, reported the same way.
    it('fails loudly instead of reporting nothing', async () => {
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        await expect(call('renderStart')).rejects.toThrow(/internal error.*csszyx bug/s);
    });
});

describe('a transform that reaches the engine before the stylesheet was read', () => {
    // The shared instance, which nothing else in this file starts: every
    // bundler adapter hands its transforms to the same hook, so the refusal has
    // to hold whichever one calls it.
    it.each([
        'vite',
        'rollup',
        'rolldown',
        'webpack',
        'rspack',
        'esbuild',
        'farm',
        'unloader',
        'bun',
    ])('fails loudly on %s', framework => {
        const plugin = rawInstance.raw(OPTIONS, { framework } as never) as unknown as {
            transform: (this: unknown, code: string, id: string) => unknown;
        };

        expect(() =>
            plugin.transform.call({ warn() {} }, APP, '/never-started/src/App.tsx'),
        ).toThrow(/internal error.*csszyx bug/s);
    });
});
