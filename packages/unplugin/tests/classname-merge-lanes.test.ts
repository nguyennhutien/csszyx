/**
 * On one element `sz` wins over a static class name, on every lane that reads
 * the project's stylesheet.
 *
 * The engine drops a class name's class that a class the `sz` beside it emits
 * fully covers, from the table the plugin builds out of the compiled CSS; the
 * pass without a table reports each pair so the plugin pays for a second pass
 * only when one would remove a class. Tailwind writes `p-4` before `pb-2`, so a
 * build that keeps both renders the bottom edge at 0.5rem.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MERGE_TABLE_FILE, writeMergeRegistration } from '../src/merge-registration.js';
import { prepareNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { type NextTurboLoaderContext, runNextTurboLoader } from '../src/next-turbo-loader.js';
import { unplugin as rawInstance, vitePlugin } from '../src/unplugin.js';
import { RESOLVED_UNSERVED_VIRTUAL_ID } from '../src/virtual-modules.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

const APP = [
    'export const Covered = () => <div className="card pb-2" sz={{ p: 4 }} />;',
    'export const Refined = () => <div className="p-4" sz={{ pb: 2 }} />;',
    '',
].join('\n');

/**
 * The class lists the emitted code carries, in order.
 *
 * @param code - Emitted module code.
 * @returns Each `className` string literal.
 */
function classNames(code: string): string[] {
    return [...code.matchAll(/className[=:]\s*"([^"]*)"/g)].map(match => match[1] as string);
}

describe.each(['rust', 'wasm'] as const)('a Vite build (%s)', parser => {
    /**
     * Transform the component once on a Vite build.
     *
     * @param build - Build options beyond the parser.
     * @returns The emitted class lists.
     */
    async function transform(build: Record<string, unknown> = {}): Promise<string[]> {
        const root = tailwindProject('csszyx-classname-merge-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/App.tsx': APP,
        });
        const call = callHooks(
            vitePlugin({
                build: { cache: false, parser, ...build },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', APP, join(root, 'src/App.tsx'))) as {
            code: string;
        };
        return classNames(result.code);
    }

    it('drops what the sz covers and keeps what it only refines', async () => {
        expect(await transform()).toEqual(['card p-4', 'p-4 pb-2']);
    }, 60_000);

    it('keeps every class when `build.mergeCoveredClasses` is off', async () => {
        expect(await transform({ mergeCoveredClasses: false })).toEqual([
            'card pb-2 p-4',
            'p-4 pb-2',
        ]);
    }, 60_000);
});

describe('a Vite build that reads its transform cache', () => {
    // The cache keeps the pass without a table, so it must keep the pairs that
    // pass reported, or a second build from the cache merges nothing.
    it('drops what the sz covers on the build that reads the cache', async () => {
        const root = tailwindProject('csszyx-classname-merge-cache-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/App.tsx': APP,
        });
        const build = async () => {
            const call = callHooks(
                vitePlugin({ production: { mangle: false } }) as unknown as Record<
                    string,
                    unknown
                >[],
            );
            await call('configResolved', { root, command: 'build' });
            return classNames(
                ((await call('transform', APP, join(root, 'src/App.tsx'))) as { code: string })
                    .code,
            );
        };
        expect(await build()).toEqual(['card p-4', 'p-4 pb-2']);
        expect(await build()).toEqual(['card p-4', 'p-4 pb-2']);
    }, 120_000);
});

describe('the count a dev server prints at start', () => {
    /**
     * Start a Vite server or build over the component, and collect warnings.
     *
     * @param command - `serve` or `build`.
     * @param build - Build options.
     * @returns What was printed.
     */
    async function start(command: 'serve' | 'build', build: Record<string, unknown> = {}) {
        const root = tailwindProject('csszyx-classname-merge-count-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/App.tsx': `${APP}export const Keys = () => <b sz={{ px: 2, p: 4 }} />;\n`,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const warnings: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            warnings.push(args.map(String).join(' '));
        });
        const call = callHooks(
            vitePlugin({
                build: { cache: false, ...build },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command });
        return warnings.filter(line => line.includes('were removed:'));
    }

    it('says once how many classes the build removed, and where to see them', async () => {
        expect(await start('serve')).toEqual([
            '[csszyx] 2 class(es) in 1 file(s) were removed: another class on the same element sets every property they set.\n' +
                '  help: `csszyx check --rule merge-covered-key --rule merge-covered-class` lists them.\n' +
                '  note: set `build.mergeCoveredClasses: false` to keep them.',
        ]);
    }, 60_000);

    it('prints nothing on a build, or with the merge off', async () => {
        expect(await start('build')).toEqual([]);
        expect(await start('serve', { mergeCoveredClasses: false })).toEqual([]);
    }, 60_000);
});

describe('the count a webpack build prints at start', () => {
    /**
     * Run a webpack compiler's first compile over the component.
     *
     * @param mode - The webpack mode.
     * @returns What was printed about removed classes.
     */
    async function compile(mode: 'development' | 'production'): Promise<string[]> {
        const root = tailwindProject('csszyx-classname-merge-webpack-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/App.tsx': APP,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const warnings: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            warnings.push(args.map(String).join(' '));
        });
        const plugin = rawInstance.raw(
            { build: { cache: false }, production: { mangle: false } },
            { framework: 'webpack' },
        ) as unknown as { webpack: (compiler: unknown) => void };
        const compiles: Promise<void>[] = [];
        plugin.webpack({
            context: root,
            options: { mode },
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
        return warnings.filter(line => line.includes('were removed:'));
    }

    it('says it once on a development build and never on a production one', async () => {
        expect(await compile('development')).toHaveLength(1);
        expect(await compile('production')).toEqual([]);
    }, 60_000);
});

describe('a Vite dev server', () => {
    // The pair's class-name side is not an sz class, and a stylesheet edit
    // that changes what covers it must still send every module through again.
    it('transforms again when a stylesheet edit changes what covers a class name', async () => {
        const app = 'export const A = () => <div className="pb-brand" sz={{ p: 4 }} />;\n';
        const withToken = '@import "tailwindcss";\n@theme {\n  --spacing-brand: 3px;\n}\n';
        const root = tailwindProject('csszyx-classname-merge-dev-', {
            'src/index.css': withToken,
            'src/App.tsx': app,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'serve' });
        const transform = async () =>
            classNames(
                ((await call('transform', app, join(root, 'src/App.tsx'))) as { code: string })
                    .code,
            );
        expect(await transform()).toEqual(['p-4']);

        let invalidated = 0;
        const graph = {
            getModuleById: () => undefined,
            getModulesByFile: () => undefined,
            invalidateModule() {},
            invalidateAll() {
                invalidated += 1;
            },
        };
        const server = {
            config: { root },
            watcher: { emit() {} },
            ws: { send() {} },
            moduleGraph: graph,
            environments: { client: { moduleGraph: graph } },
        };
        await call('load', RESOLVED_UNSERVED_VIRTUAL_ID);
        const css = join(root, 'src/index.css');
        writeFileSync(css, '@import "tailwindcss";\n', 'utf8');
        await call('hotUpdate', { type: 'update', file: css, modules: [], server });

        expect(invalidated).toBeGreaterThan(0);
        expect(await transform()).toEqual(['pb-brand p-4']);
    }, 120_000);
});

describe.each(['rust', 'wasm'] as const)('the Turbopack loader (%s)', parserMode => {
    it('drops what the sz covers, from the table a Next command wrote', async () => {
        const source = 'export default () => <div className="card pb-2" sz={{ p: 4 }} />;\n';
        const root = tailwindProject('csszyx-classname-merge-next-', {
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': '@import "tailwindcss";',
            'app/page.tsx': source,
        });
        const facts = await prepareNextStylesheetFacts({ explicitRoot: root });
        writeMergeRegistration({
            root,
            model: facts.model,
            classes: ['p-4'],
            authoredClasses: ['card', 'pb-2'],
            mergeLiterals: [],
        });
        const context: NextTurboLoaderContext = {
            resourcePath: join(root, 'app/page.tsx'),
            rootContext: root,
            context: join(root, 'app'),
            mode: 'development',
            addDependency() {},
        };
        const options = {
            config: { mangleVars: false },
            writeOptions: { retryDelayMs: 0 },
            materializeSafelist: false,
            parserMode,
        };

        expect(classNames(runNextTurboLoader(source, context, options).code)).toEqual(['card p-4']);
        expect(
            classNames(
                runNextTurboLoader(source, context, { ...options, mergeCoveredClasses: false })
                    .code,
            ),
        ).toEqual(['card pb-2 p-4']);
        expect(MERGE_TABLE_FILE).toBe('merge-table.json');
    }, 60_000);
});
