/**
 * Which project walks follow `.gitignore`, and which read every source on
 * purpose.
 *
 * The sz prescan, the Next prebuild and watch, and `csszyx check` read a
 * gitignored source like any other: Tailwind cannot read an sz object, so a
 * generated component the walk skipped would ship without its CSS. The walks
 * that read stylesheets and markup for theme tokens and merge hooks follow
 * `.gitignore`, the way Tailwind's own scanner does, except for a stylesheet
 * another file imports.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { rollupPlugin, vitePlugin } from '../src/unplugin.js';
import { RESOLVED_THEME_GROUPS_VIRTUAL_ID } from '../src/virtual-modules.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

const TW = '@import "tailwindcss";\n';

/**
 * Run a Vite build's prescan over the files.
 *
 * @param files - Project files.
 * @returns The safelist it wrote.
 */
async function vitePrescan(files: Record<string, string>): Promise<string> {
    const root = tailwindProject('csszyx-gitignore-vite-', { 'src/index.css': TW, ...files });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const call = callHooks(
        vitePlugin({
            build: { cache: false },
            production: { mangle: false },
        }) as unknown as Record<string, unknown>[],
    );
    await call('configResolved', { root, command: 'build' });
    return readFileSync(join(root, '.csszyx/csszyx-classes.txt'), 'utf8');
}

/** A gitignored generated component, and the class its `sz` lowers to. */
const GENERATED: Record<string, string> = {
    '.gitignore': 'src/generated/\n',
    'src/generated/Badge.tsx': 'export const Badge = () => <div sz={{ m: 9 }} />;\n',
};

/**
 * Run a webpack compiler's prescan over the files.
 *
 * @param files - Project files.
 * @returns The safelist it wrote.
 */
async function webpackPrescan(files: Record<string, string>): Promise<string> {
    const root = tailwindProject('csszyx-gitignore-webpack-prescan-', {
        'src/index.css': TW,
        ...files,
    });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.resetModules();
    const { unplugin } = await import('../src/unplugin.js');
    const plugins = [
        unplugin.raw({ build: { cache: false }, production: { mangle: false } }, {
            framework: 'webpack',
        } as never),
    ].flat() as Array<{ webpack?: (compiler: unknown) => void }>;
    const compiles: Promise<void>[] = [];
    plugins
        .find(plugin => plugin.webpack)
        ?.webpack?.({
            context: root,
            options: { mode: 'production' },
            hooks: {
                beforeCompile: {
                    tap: (_name: string, run: () => void) => run(),
                    tapPromise: (_name: string, run: () => Promise<void>) => {
                        compiles.push(run());
                    },
                },
                thisCompilation: { tap: () => undefined },
            },
        });
    await Promise.all(compiles);
    return readFileSync(join(root, '.csszyx/csszyx-classes.txt'), 'utf8');
}

describe('the sz prescan', () => {
    it.each([
        ['Vite', vitePrescan],
        ['webpack', webpackPrescan],
    ])(
        'of a %s build safelists a gitignored generated component',
        async (_lane, prescan) => {
            // Tailwind skips the file, and cannot read an sz object anyway: the
            // safelist is the only way its classes get CSS.
            const safelist = await prescan({
                ...GENERATED,
                'src/A.tsx': 'export const A = () => <div sz={{ p: 7 }} />;\n',
            });
            expect(safelist).toContain('p-7');
            expect(safelist).toContain('m-9');
        },
        60_000,
    );

    it('reads a source under a folder named like a generated report', async () => {
        const safelist = await vitePrescan({
            'src/features/target/Card.tsx': 'export const A = () => <div sz={{ p: 7 }} />;\n',
            'src/coverage/Badge.tsx': 'export const B = () => <div sz={{ m: 7 }} />;\n',
        });
        expect(safelist).toContain('p-7');
        expect(safelist).toContain('m-7');
    }, 60_000);
});

/** A generated page whose style block selects on `shadow-md`. */
const REPORT_PAGE = '<html><head><style>.card.shadow-md { outline: 0; }</style></head></html>\n';
/** A scoped Vue style block that selects on `shadow-md`. */
const SCOPED_STYLE = '<style scoped>.card.shadow-md { outline: 0; }</style>\n';
/** A component whose `sz` covers `shadow-md`, unless something selects on it. */
const COVERED =
    'export const A = () => <div className="card shadow-md" sz={{ shadow: "lg" }} />;\n';
/** A component that selects on `shadow-md` from markup. */
const HOOK = 'export const B = () => <b className="group-[.shadow-md]:p-2" />;\n';

/**
 * Files whose hooks only `.gitignore` keeps out: a report under a folder the
 * root `.gitignore` names, a component a nested `.gitignore` names, and a
 * source in an ignored folder.
 */
const IGNORED_HOOKS: Record<string, string> = {
    '.gitignore': 'reports/\n/generated/\n',
    'reports/index.html': REPORT_PAGE,
    'src/legacy/.gitignore': '*.vue\n',
    'src/legacy/Card.vue': SCOPED_STYLE,
    'generated/B.tsx': HOOK,
};

type LanePlugin = {
    buildStart?: (this: unknown) => Promise<void>;
    transform?: (this: unknown, code: string, id: string) => unknown;
    webpack?: (compiler: unknown) => void;
};

/**
 * The code a transform returned.
 *
 * @param result - A transform hook's result.
 * @returns Its code.
 */
const codeOf = (result: unknown): string =>
    typeof result === 'string' ? result : ((result as { code?: string } | null)?.code ?? '');

/**
 * The class lists a lane emits for `src/A.tsx` after its walk.
 *
 * @param lane - Which bundler lane runs.
 * @param files - Files beside `src/index.css` and `src/A.tsx`.
 * @param before - Modules transformed before `src/A.tsx`, as a bundler that
 *        reached them first would.
 * @returns The emitted code for `src/A.tsx`.
 */
async function laneEmits(
    lane: 'vite' | 'webpack' | 'rollup' | 'esbuild',
    files: Record<string, string>,
    before: string[] = [],
): Promise<string> {
    const root = tailwindProject(`csszyx-gitignore-${lane}-`, {
        'src/index.css': TW,
        'src/A.tsx': COVERED,
        ...files,
    });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const options = { build: { cache: false }, production: { mangle: false } };
    const ctx = { warn() {}, error() {}, meta: {}, addWatchFile() {} };
    let transform: (code: string, id: string) => Promise<unknown>;
    if (lane === 'vite') {
        const call = callHooks(vitePlugin(options) as unknown as Record<string, unknown>[]);
        await call('configResolved', { root, command: 'build' });
        transform = (code, id) => call('transform', code, id);
    } else {
        // The webpack and esbuild lanes go through the module's one shared
        // instance; a fresh module gives each test its own.
        vi.resetModules();
        const raw =
            lane === 'rollup'
                ? rollupPlugin(options)
                : (await import('../src/unplugin.js')).unplugin.raw(options, {
                      framework: lane,
                  } as never);
        const plugins = [raw].flat() as LanePlugin[];
        const main = plugins.find(plugin => plugin.transform !== undefined) as LanePlugin;
        if (lane === 'webpack') {
            const compiles: Promise<void>[] = [];
            plugins
                .find(plugin => plugin.webpack)
                ?.webpack?.({
                    context: root,
                    options: { mode: 'production' },
                    hooks: {
                        beforeCompile: {
                            tap: (_name: string, run: () => void) => run(),
                            tapPromise: (_name: string, run: () => Promise<void>) => {
                                compiles.push(run());
                            },
                        },
                        thisCompilation: { tap: () => undefined },
                    },
                });
            await Promise.all(compiles);
        } else {
            await plugins.find(plugin => plugin.buildStart)?.buildStart?.call(ctx);
        }
        transform = async (code, id) => main.transform?.call(ctx, code, id);
    }
    for (const file of before) {
        await transform(files[file] as string, join(root, file));
    }
    return codeOf(await transform(COVERED, join(root, 'src/A.tsx')));
}

describe.each(['vite', 'webpack', 'rollup', 'esbuild'] as const)('the %s lane', lane => {
    it('drops the class when nothing selects on it', async () => {
        expect(await laneEmits(lane, {})).toContain('card shadow-lg');
    }, 60_000);

    it('reads hooks from what git keeps', async () => {
        const code = await laneEmits(lane, { 'src/B.tsx': HOOK });
        expect(code).toContain('card shadow-md shadow-lg');
    }, 60_000);

    it('reads no hook from a file .gitignore covers', async () => {
        const code = await laneEmits(lane, IGNORED_HOOKS);
        expect(code).toContain('card shadow-lg');
        expect(code).not.toContain('shadow-md');
    }, 60_000);
});

/**
 * A module the walk does not read hooks from is still the app's once a bundler
 * transforms it. On a lane whose merges wait for the transform, a module
 * transformed first keeps the class; webpack settles its merges at the
 * prescan, and stops the build over a hook it learns of later instead.
 */
describe.each(['vite', 'rollup', 'esbuild'] as const)('a module the %s lane transforms', lane => {
    it('adds its hooks from an ignored folder', async () => {
        const code = await laneEmits(lane, IGNORED_HOOKS, ['generated/B.tsx']);
        expect(code).toContain('card shadow-md shadow-lg');
    }, 60_000);

    it('adds its hooks from a folder named `build`', async () => {
        // The walk skips any `build/` folder; a module a bundler transforms
        // from one is still the app's, and so is what it selects on.
        const code = await laneEmits(lane, { 'src/build/B.tsx': HOOK }, ['src/build/B.tsx']);
        expect(code).toContain('card shadow-md shadow-lg');
    }, 60_000);
});

describe('the webpack lane', () => {
    it('stops the build over a hook in an ignored module it transforms after its merges', async () => {
        const root = tailwindProject('csszyx-gitignore-webpack-late-', {
            'src/index.css': TW,
            'src/A.tsx': COVERED,
            ...IGNORED_HOOKS,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.resetModules();
        const { unplugin } = await import('../src/unplugin.js');
        const plugins = [
            unplugin.raw({ build: { cache: false }, production: { mangle: false } }, {
                framework: 'webpack',
            } as never),
        ].flat() as LanePlugin[];
        const compiles: Promise<void>[] = [];
        const onCompilation: Array<(compilation: unknown) => void> = [];
        plugins
            .find(plugin => plugin.webpack)
            ?.webpack?.({
                context: root,
                options: { mode: 'production' },
                hooks: {
                    beforeCompile: {
                        tap: (_name: string, run: () => void) => run(),
                        tapPromise: (_name: string, run: () => Promise<void>) => {
                            compiles.push(run());
                        },
                    },
                    thisCompilation: {
                        tap: (_name: string, run: (compilation: unknown) => void) => {
                            onCompilation.push(run);
                        },
                    },
                },
            });
        await Promise.all(compiles);
        const finishModules: Array<() => Promise<void>> = [];
        const compilation = {
            errors: [],
            fileDependencies: new Set<string>(),
            hooks: {
                finishModules: {
                    tapPromise: (_name: string, run: () => Promise<void>) => {
                        finishModules.push(run);
                    },
                },
            },
        };
        for (const run of onCompilation) run(compilation);
        const main = plugins.find(plugin => plugin.transform !== undefined) as LanePlugin;
        const ctx = { warn() {}, error() {}, meta: {}, addWatchFile() {} };
        const merged = codeOf(await main.transform?.call(ctx, COVERED, join(root, 'src/A.tsx')));
        expect(merged).toContain('card shadow-lg');
        await main.transform?.call(ctx, HOOK, join(root, 'generated/B.tsx'));
        expect(finishModules.length).toBeGreaterThan(0);
        await expect(Promise.all(finishModules.map(run => run()))).rejects.toThrow(/`shadow-md`/);
    }, 60_000);
});

describe('the stylesheets a Vite build reads for theme tokens', () => {
    /**
     * The szcn theme-group module a Vite build serves.
     *
     * @param files - Project files.
     * @returns The module text.
     */
    async function themeGroups(files: Record<string, string>): Promise<string> {
        const root = tailwindProject('csszyx-gitignore-theme-', files);
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        return (await call('load', RESOLVED_THEME_GROUPS_VIRTUAL_ID)) as string;
    }

    it('keep the merge groups of a gitignored @theme file a stylesheet imports', async () => {
        const groups = await themeGroups({
            '.gitignore': 'generated/\n',
            'src/index.css': `${TW}@import "../generated/tokens.css";\n`,
            'generated/tokens.css': '@theme { --color-brand: #123456; }\n',
        });
        expect(groups).toContain('brand');
    }, 60_000);

    it('take no tokens from a gitignored stylesheet nothing imports', async () => {
        const groups = await themeGroups({
            '.gitignore': 'out/\n',
            'src/index.css': `${TW}@theme { --color-brand: #123456; }\n`,
            'out/static/old.css': '@theme { --color-stale: #000; }\n',
        });
        expect(groups).toContain('brand');
        expect(groups).not.toContain('stale');
    }, 60_000);

    it('read a gitignored stylesheet a source imports for the prefix', async () => {
        // The JS import is the evidence: the prefix it sets is the one the
        // build serves, so the sz it lowers carries it.
        const root = tailwindProject('csszyx-gitignore-js-css-', {
            '.gitignore': 'generated/\n',
            'generated/app.css': '@import "tailwindcss" prefix(tw);\n',
            'src/main.tsx': 'import "../generated/app.css";\n',
            'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;\n',
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        const out = codeOf(
            await call(
                'transform',
                'export const A = () => <div sz={{ p: 4 }} />;\n',
                join(root, 'src/A.tsx'),
            ),
        );
        expect(out).toContain('tw:p-4');
    }, 60_000);
});
