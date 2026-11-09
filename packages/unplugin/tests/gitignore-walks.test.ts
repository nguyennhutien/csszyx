/**
 * Which project walks follow `.gitignore`, and which read every source on
 * purpose.
 *
 * Every walk follows `.gitignore` the way Tailwind's automatic detection
 * does (ADR 0033). The sz prescan takes back what a stylesheet's `@source`
 * names, as the project's own Scanner lists it, so a gitignored folder
 * Tailwind is pointed at reaches the safelist too. The stylesheet walk keeps
 * a gitignored stylesheet another file imports.
 */
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import { type InlineConfig, resolveConfig } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { rollupPlugin, vitePlugin } from '../src/unplugin.js';
import { RESOLVED_THEME_GROUPS_VIRTUAL_ID } from '../src/virtual-modules.js';
import {
    callHooks,
    linkTailwindIntegration,
    removeTailwindProjects,
    tailwindProject,
} from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

const TW = '@import "tailwindcss";\n';

/**
 * Run a Vite build's prescan over the files.
 *
 * @param files - Project files.
 * @param options - Fixture switches.
 * @param options.integration - False to leave Tailwind's integration, and its
 *        Scanner, out of the project.
 * @param options.compileSources - The plugin's `compileSources`.
 * @returns The safelist it wrote.
 */
async function vitePrescan(
    files: Record<string, string>,
    options: { integration?: boolean; compileSources?: string[] } = {},
): Promise<string> {
    const root = tailwindProject('csszyx-gitignore-vite-', { 'src/index.css': TW, ...files });
    // The Scanner that lists what an `@source` names comes with the integration.
    if (options.integration !== false) linkTailwindIntegration(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const call = callHooks(
        vitePlugin({
            build: { cache: false },
            production: { mangle: false },
            ...(options.compileSources ? { compileSources: options.compileSources } : {}),
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
    linkTailwindIntegration(root);
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
    const lanes = [
        ['Vite', vitePrescan],
        ['webpack', webpackPrescan],
    ] as const;

    it.each(lanes)(
        'of a %s build leaves out a gitignored component no `@source` names',
        async (_lane, prescan) => {
            const safelist = await prescan({
                ...GENERATED,
                'src/A.tsx': 'export const A = () => <div sz={{ p: 7 }} />;\n',
            });
            expect(safelist).toContain('p-7');
            expect(safelist).not.toContain('m-9');
        },
        60_000,
    );

    it.each(lanes)(
        'of a %s build safelists a gitignored folder a stylesheet names with `@source`',
        async (_lane, prescan) => {
            // The rules also name a note, which is no source, and a folder
            // the walk read already, which is not read twice.
            const safelist = await prescan({
                ...GENERATED,
                'src/generated/notes.md': '# p-99\n',
                'src/index.css': `${TW}@source "./generated";\n@source "./features";\n`,
                'src/features/F.tsx': 'export const F = () => <div sz={{ p: 8 }} />;\n',
                'src/A.tsx': 'export const A = () => <div sz={{ p: 7 }} />;\n',
            });
            expect(safelist).toContain('p-8');
            expect(safelist).toContain('p-7');
            expect(safelist).toContain('m-9');
        },
        60_000,
    );

    it('leaves out a file a stylesheet names outside the project root', async () => {
        // Outside the root, a package is opted in through `compileSources`,
        // as `csszyx check` and the Next prebuild read it.
        const outside = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-outside-')));
        try {
            writeFileSync(
                join(outside, 'Far.tsx'),
                'export const F = () => <div sz={{ m: 13 }} />;\n',
            );
            const safelist = await vitePrescan({
                'src/index.css': `${TW}@source "${outside}";\n`,
                'src/A.tsx': 'export const A = () => <div sz={{ p: 7 }} />;\n',
            });
            expect(safelist).toContain('p-7');
            expect(safelist).not.toContain('m-13');
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    }, 60_000);

    it('safelists a file a stylesheet names in a `compileSources` folder reached through a link', async () => {
        // The Scanner reports the real path; the folder is written as the link.
        const outside = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-outside-')));
        const link = `${outside}-link`;
        symlinkSync(outside, link);
        try {
            mkdirSync(join(outside, 'gen'));
            writeFileSync(join(outside, '.gitignore'), 'gen/\n');
            writeFileSync(
                join(outside, 'gen/Far.tsx'),
                'export const F = () => <div sz={{ m: 13 }} />;\n',
            );
            const safelist = await vitePrescan(
                {
                    'src/index.css': `${TW}@source "${link}/gen";\n`,
                    'src/A.tsx': 'export const A = () => <div sz={{ p: 7 }} />;\n',
                },
                { compileSources: [link] },
            );
            expect(safelist).toContain('p-7');
            expect(safelist).toContain('m-13');
        } finally {
            rmSync(link, { force: true });
            rmSync(outside, { recursive: true, force: true });
        }
    }, 60_000);

    it('reads what git keeps when the project has no Scanner to list a rule', async () => {
        const safelist = await vitePrescan(
            {
                ...GENERATED,
                'src/index.css': `${TW}@source "./generated";\n`,
                'src/A.tsx': 'export const A = () => <div sz={{ p: 7 }} />;\n',
            },
            { integration: false },
        );
        expect(safelist).toContain('p-7');
        expect(safelist).not.toContain('m-9');
    }, 60_000);

    it.each([
        // Beside automatic detection, Tailwind 4.3.3 reads the whole folder
        // a single-file rule opens; under `source(none)`, that file alone.
        ['the whole gitignored folder', TW, true],
        ['only that file under `source(none)`', '@import "tailwindcss" source(none);\n', false],
    ])(
        'safelists, for one gitignored file a stylesheet names, %s',
        async (_name, head, folder) => {
            const safelist = await vitePrescan({
                ...GENERATED,
                'src/generated/Other.tsx': 'export const O = () => <div sz={{ m: 11 }} />;\n',
                'src/index.css': `${head}@source "./generated/Badge.tsx";\n`,
            });
            expect(safelist).toContain('m-9');
            expect(safelist.includes('m-11')).toBe(folder);
        },
        60_000,
    );

    it('safelists the gitignored folder a glob into it opens', async () => {
        const safelist = await vitePrescan({
            ...GENERATED,
            'src/generated/deep/Other.jsx': 'export const O = () => <div sz={{ m: 11 }} />;\n',
            'src/index.css': `${TW}@source "./generated/*.tsx";\n`,
        });
        expect(safelist).toContain('m-9');
        expect(safelist).toContain('m-11');
    }, 60_000);

    it('writes the same safelist when an unrelated gitignored folder grows', async () => {
        const base = {
            ...GENERATED,
            'src/index.css': `${TW}@source "./generated";\n`,
            'src/A.tsx': 'export const A = () => <div sz={{ p: 7 }} />;\n',
        };
        const grown: Record<string, string> = { ...base, '.gitignore': 'src/generated/\ncache/\n' };
        for (let index = 0; index < 50; index++) {
            grown[`cache/${index}/C.tsx`] =
                `export const C = () => <div sz={{ m: ${index + 20} }} />;\n`;
        }
        expect(await vitePrescan(grown)).toBe(await vitePrescan(base));
    }, 60_000);

    it('reads a source under a folder named like a generated report', async () => {
        const safelist = await vitePrescan({
            'src/features/target/Card.tsx': 'export const A = () => <div sz={{ p: 7 }} />;\n',
            'src/coverage/Badge.tsx': 'export const B = () => <div sz={{ m: 7 }} />;\n',
        });
        expect(safelist).toContain('p-7');
        expect(safelist).toContain('m-7');
    }, 60_000);
});

/**
 * A module the bundler lowers from a gitignored folder no stylesheet names:
 * the safelist scan never read it, and the build says so once, at its end.
 */
describe('a gitignored module the build lowers', () => {
    const BADGE = GENERATED['src/generated/Badge.tsx'] as string;

    /**
     * What a Vite build printed after lowering modules and ending.
     *
     * @param files - Project files beside `src/index.css`.
     * @param css - The stylesheet.
     * @param lowered - The modules the bundler lowers, relative to the root,
     *        or absolute for one outside it.
     * @param options - Fixture switches.
     * @param options.mangle - Whether the build mangles, which freezes the
     *        class map.
     * @param options.integration - False to leave Tailwind's integration, and
     *        its Scanner, out of the project.
     * @param options.late - Files written after the prescan.
     * @returns Everything it warned, then the error that stopped it, if any.
     */
    async function warnedAfter(
        files: Record<string, string>,
        css: string,
        lowered: string | readonly string[],
        options: { mangle?: boolean; integration?: boolean; late?: Record<string, string> } = {},
    ): Promise<string> {
        const { mangle = false } = options;
        const root = tailwindProject('csszyx-gitignore-late-', { ...files, 'src/index.css': css });
        if (options.integration !== false) linkTailwindIntegration(root);
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const warned: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
            warned.push(String(message));
        });
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        // Written after the prescan, as a generator in watch mode does.
        for (const [file, text] of Object.entries(options.late ?? {})) {
            mkdirSync(dirname(join(root, file)), { recursive: true });
            writeFileSync(join(root, file), text);
        }
        for (const module of typeof lowered === 'string' ? [lowered] : lowered) {
            const id = isAbsolute(module) ? module : join(root, module);
            const code = files[module] ?? options.late?.[module] ?? BADGE;
            // Twice, as a build with two environments resolves it: named once.
            await call('transform', code, id);
            await call('transform', code, `${id}?v=2`);
        }
        try {
            await call('buildEnd');
        } catch (error) {
            warned.push((error as Error).message);
        }
        return warned.join('\n');
    }

    it('is named at the end of the build, with the `@source` that reads it', async () => {
        const warned = await warnedAfter(GENERATED, TW, 'src/generated/Badge.tsx');
        expect(warned).toContain(
            'The build lowered 1 file(s) with `sz` that `.gitignore` covers and the safelist scan did not read',
        );
        expect(warned).toContain('Tailwind may generate no CSS for their classes');
        expect(warned).toContain('name them in `src/index.css`');
        expect(warned).toContain('`@source "./generated";`');
        expect(warned).toContain('src/generated/Badge.tsx');
    }, 60_000);

    it('is named for a module that only declares `szv`, which the transform does not lower', async () => {
        const module = 'src/generated/variants.ts';
        const warned = await warnedAfter(
            { ...GENERATED, [module]: 'export const v = szv({ base: { p: 3 } });\n' },
            TW,
            module,
        );
        expect(warned).toContain('src/generated/variants.ts');
    }, 60_000);

    it('is not named for a component the prescan reads no classes from', async () => {
        const module = 'src/generated/Card.vue';
        const warned = await warnedAfter(
            { ...GENERATED, [module]: '<template><div :sz="{ m: 9 }" /></template>\n' },
            TW,
            module,
        );
        expect(warned).not.toContain('`.gitignore` covers');
    }, 60_000);

    it('writes the file, not its folder, when a pattern of `.gitignore` covers it', async () => {
        // `@source "."` does not take back a file a pattern covers; its
        // own path does.
        const warned = await warnedAfter(
            { '.gitignore': '*.gen.tsx\n', 'src/Badge.gen.tsx': BADGE },
            TW,
            'src/Badge.gen.tsx',
        );
        expect(warned).toContain('`@source "./Badge.gen.tsx";`');
    }, 60_000);

    it('writes one `@source` per gitignored folder', async () => {
        const warned = await warnedAfter(
            { '.gitignore': 'src/generated/\nout/\n', 'out/B.tsx': BADGE },
            TW,
            ['src/generated/Badge.tsx', 'out/B.tsx'],
        );
        expect(warned).toContain('`@source "../out";`, `@source "./generated";`');
    }, 60_000);

    it('says when the Scanner that lists what `@source` names cannot be loaded', async () => {
        const warned = await warnedAfter(
            GENERATED,
            `${TW}@source "./generated";\n`,
            'src/generated/Badge.tsx',
            { integration: false },
        );
        expect(warned).toContain("could not load Tailwind's Scanner");
        expect(warned).not.toContain('no stylesheet names');
    }, 60_000);

    it('is not named when it appeared after the prescan in a folder `@source` names', async () => {
        const warned = await warnedAfter(
            GENERATED,
            `${TW}@source "./generated";\n`,
            'src/generated/New.tsx',
            { late: { 'src/generated/New.tsx': BADGE } },
        );
        expect(warned).not.toContain('`.gitignore` covers');
    }, 60_000);

    it('is named before a mangled build stops on the class it brought late', async () => {
        const warned = await warnedAfter(GENERATED, TW, 'src/generated/Badge.tsx', {
            mangle: true,
        });
        const named = warned.indexOf('`.gitignore` covers and the safelist scan');
        const stopped = warned.indexOf('appeared after the mangle map was frozen');
        expect(named).toBeGreaterThan(-1);
        expect(stopped).toBeGreaterThan(named);
        expect(warned.slice(stopped)).toContain('`@source`');
    }, 60_000);

    it('writes the `@source` path from the stylesheet, up out of its folder', async () => {
        const warned = await warnedAfter(
            { '.gitignore': 'generated/\n', 'generated/Badge.tsx': BADGE },
            TW,
            'generated/Badge.tsx',
        );
        expect(warned).toContain('`@source "../generated";`');
    }, 60_000);

    it('writes the `@source` path from the project root when no stylesheet is a root', async () => {
        const warned = await warnedAfter(GENERATED, '', 'src/generated/Badge.tsx');
        expect(warned).toContain('`@source "./src/generated";`');
    }, 60_000);

    it('is not named for a module outside the project', async () => {
        const outside = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-outside-')));
        try {
            const warned = await warnedAfter({}, TW, join(outside, 'Badge.tsx'));
            expect(warned).not.toContain('`.gitignore` covers');
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    }, 60_000);

    it('is not named once a stylesheet names its folder', async () => {
        const warned = await warnedAfter(
            GENERATED,
            `${TW}@source "./generated";\n`,
            'src/generated/Badge.tsx',
        );
        expect(warned).not.toContain('`.gitignore` covers');
    }, 60_000);

    it('is not named when the walk left it out for another reason', async () => {
        const warned = await warnedAfter(
            { 'src/build/Badge.tsx': BADGE },
            TW,
            'src/build/Badge.tsx',
        );
        expect(warned).not.toContain('`.gitignore` covers');
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
            missingDependencies: new Set<string>(),
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
     * @param resolve - The resolved Vite config's `resolve`, given the root.
     * @param warned - Collects what the build printed.
     * @param tailwind - The integration the build runs Tailwind through.
     * @returns The module text.
     */
    async function themeGroups(
        files: Record<string, string>,
        resolve: (root: string) => unknown = () => undefined,
        warned: string[] = [],
        tailwind: 'vite' | 'postcss' = 'vite',
    ): Promise<string> {
        const root = tailwindProject('csszyx-gitignore-theme-', files);
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
            warned.push(String(message));
        });
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        // A real resolved config: the lane asks Vite's own resolver.
        const config = await resolveConfig(
            {
                root,
                configFile: false,
                logLevel: 'silent',
                resolve: resolve(root) as InlineConfig['resolve'],
                plugins: tailwind === 'vite' ? [{ name: '@tailwindcss/vite:scan' }] : [],
            },
            'build',
        );
        await call('configResolved', config);
        return (await call('load', RESOLVED_THEME_GROUPS_VIRTUAL_ID)) as string;
    }

    /**
     * A gitignored `@theme` file under `src/gen/`, imported by `src/index.css`.
     *
     * @param line - The importing line of `src/index.css`.
     * @returns The project files.
     */
    const aliasedTheme = (line: string): Record<string, string> => ({
        '.gitignore': 'src/gen/\n',
        'src/index.css': `${TW}${line}\n`,
        'src/gen/tokens.css': '@theme { --color-brand: #123456; }\n',
        'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    });

    it.each([
        // What `@tailwindcss/vite` 4.3.3 reads on Vite 8.3.1, measured with a
        // real `vite build`: each of these imports sets the token.
        [
            'a `resolve.alias`',
            '@import "@/gen/tokens.css";',
            (root: string) => ({ alias: [{ find: '@', replacement: join(root, 'src') }] }),
        ],
        [
            'a `resolve.alias` whose customResolver is a function',
            '@import "@/gen/tokens.css";',
            (root: string) => ({
                alias: [
                    {
                        find: '@',
                        replacement: '@',
                        customResolver: (id: string) => id.replace(/^@/, join(root, 'src')),
                    },
                ],
            }),
        ],
        [
            'tsconfig `paths` with `resolve.tsconfigPaths`',
            '@import "@/gen/tokens.css";',
            () => ({ alias: [], tsconfigPaths: true }),
        ],
        [
            'a bare path against the importing folder',
            '@import "gen/tokens.css";',
            () => ({ alias: [] }),
        ],
    ])(
        'keep the merge groups of a gitignored @theme file imported through %s',
        async (_name, line, resolve) => {
            expect(await themeGroups(aliasedTheme(line), resolve)).toContain('brand');
        },
        60_000,
    );

    it('leave out, and name, a stylesheet whose tsconfig `paths` import Vite does not read', async () => {
        // Without `resolve.tsconfigPaths` the import fails a Vite build that
        // loads the stylesheet, and only then: the model reads no theme from
        // it, and the build goes on with one line that names it.
        const warned: string[] = [];
        const groups = await themeGroups(
            aliasedTheme('@import "@/gen/tokens.css";'),
            () => ({ alias: [] }),
            warned,
        );
        expect(groups).not.toContain('brand');
        expect(warned.join('\n')).toContain(
            "[csszyx] src/index.css imports `@/gen/tokens.css`, which this build's Tailwind cannot resolve",
        );
    }, 60_000);

    it.each([
        // `@tailwindcss/postcss` 4.3.3 on Vite 8.3.1, measured with a real
        // `vite build`: Vite inlines the import through its CSS resolver.
        [
            'a `resolve.alias`',
            (root: string) => ({ alias: [{ find: '@', replacement: join(root, 'src') }] }),
            true,
        ],
        ['tsconfig `paths`, `resolve.tsconfigPaths` on', () => ({ tsconfigPaths: true }), false],
    ])(
        'under `@tailwindcss/postcss`, read an import through %s as the Vite build does',
        async (_name, resolve, follows) => {
            const warned: string[] = [];
            const groups = await themeGroups(
                aliasedTheme('@import "@/gen/tokens.css";'),
                resolve,
                warned,
                'postcss',
            );
            expect(groups.includes('brand')).toBe(follows);
            expect(warned.join('\n').includes('imports `@/gen/tokens.css`')).toBe(!follows);
        },
        60_000,
    );

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
