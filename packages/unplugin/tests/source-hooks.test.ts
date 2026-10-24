/**
 * A merge keeps every class the project selects on, wherever the selector is
 * written.
 *
 * Stylesheets are one place. Two others reach the page without passing
 * through one: an arbitrary variant in markup or lowered from `sz`
 * (`group-[.shadow-md]:p-2` selects on `shadow-md`), and a `<style>` block in
 * a Vue, Svelte or Astro component. A class removed while one of them selects
 * on it breaks the page with a green build, so the build reads them before
 * the first merge, and stops when a lane learns of one too late.
 */
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ContentScanner, isHook, noClassHooks } from '@csszyx/tailwind-oracle';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { auditMerges } from '../src/merge-audit.js';
import { MERGE_TABLE_FILE, writeMergeRegistration } from '../src/merge-registration.js';
import { prepareNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { openProjectStyleModel, type ProjectStyleModel } from '../src/project-style-model.js';
import { SourceHookRegistry } from '../src/source-hooks.js';
import { rollupPlugin, vitePlugin } from '../src/unplugin.js';
import { RESOLVED_UNSERVED_VIRTUAL_ID } from '../src/virtual-modules.js';
import {
    callHooks,
    linkTailwindIntegration,
    removeTailwindProjects,
    tailwindProject,
} from './tailwind-project.js';

/** Links made in place of a project root, removed with the projects. */
const linkedRoots: string[] = [];

afterEach(() => {
    for (const link of linkedRoots.splice(0)) rmSync(link, { force: true });
    removeTailwindProjects();
    vi.restoreAllMocks();
});

const TW = '@import "tailwindcss";\n';
/** A generated page whose style block selects on `shadow-md`. */
const REPORT_PAGE = '<html><head><style>.card.shadow-md { outline: 0; }</style></head></html>\n';
/** A scoped Vue style block that selects on `shadow-md`. */
const SCOPED_STYLE = '<style scoped>.card.shadow-md { outline: 0; }</style>\n';
const COVERED =
    'export const A = () => <div className="card shadow-md" sz={{ shadow: "lg" }} />;\n';

describe('the style model', () => {
    it('reads a variant an unimported stylesheet applies', async () => {
        const root = tailwindProject('csszyx-source-hooks-model-', {
            'src/index.css': TW,
            'src/card.css': '.card { @apply [&.shadow-md]:p-2; }\n',
        });
        const model = await openProjectStyleModel(root, [
            join(root, 'src/index.css'),
            join(root, 'src/card.css'),
        ]);
        expect(model.mergeSignature('shadow-md')).toBeNull();
        expect(model.mergeSignature('shadow-lg')).not.toBeNull();
    }, 60_000);

    it('names what a variant selects on, and takes hooks read from sources', async () => {
        const root = tailwindProject('csszyx-source-hooks-model-', { 'src/index.css': TW });
        const model = await openProjectStyleModel(root, [join(root, 'src/index.css')]);
        const hooks = model.variantHooks(['group-[.shadow-md]:p-2', 'hover:p-4']);
        expect(isHook(hooks, 'shadow-md')).toBe(true);
        expect(isHook(hooks, 'p-4')).toBe(false);

        const hooked = model.withSourceHooks(hooks);
        expect(hooked.mergeSignature('shadow-md')).toBeNull();
        expect(hooked.mergeSignature('shadow-lg')).not.toBeNull();
        // A view: the model it came from is unchanged, and the sources' hooks
        // are replaced, not added to, so a hook an edit removed goes away.
        expect(model.mergeSignature('shadow-md')).not.toBeNull();
        expect(hooked.withSourceHooks(noClassHooks()).mergeSignature('shadow-md')).not.toBeNull();
    }, 60_000);
});

describe.each(['rust', 'wasm'] as const)('a Vite build (%s)', parser => {
    /**
     * Build a project and transform one file, as the build does after its
     * prescan.
     *
     * @param files - Files beside `src/index.css`.
     * @param file - The file to transform.
     * @returns The class lists it emits.
     */
    async function build(files: Record<string, string>, file = 'src/A.tsx'): Promise<string[]> {
        const root = tailwindProject('csszyx-source-hooks-', { 'src/index.css': TW, ...files });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const call = callHooks(
            vitePlugin({
                build: { cache: false, parser },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        const source = files[file] as string;
        const result = (await call('transform', source, join(root, file))) as { code: string };
        return [...result.code.matchAll(/className[=:]\s*"([^"]*)"/g)].map(m => m[1] as string);
    }

    it('drops the class when nothing selects on it', async () => {
        expect(await build({ 'src/A.tsx': COVERED })).toEqual(['card shadow-lg']);
    }, 60_000);

    it.each([
        [
            'markup in another file',
            { 'src/B.tsx': 'export const B = () => <b className="group-[.shadow-md]:p-2" />;\n' },
        ],
        [
            'markup in the same file',
            {
                'src/A.tsx': `${COVERED}export const B = () => <b className="[&.shadow-md]:p-2" />;\n`,
            },
        ],
        [
            'an sz key in another file',
            {
                'src/B.tsx':
                    'export const B = () => <b sz={{ group: { ".shadow-md": { p: 2 } } }} />;\n',
            },
        ],
        [
            'a Vue style block',
            {
                'src/Card.vue':
                    '<template><div /></template>\n<style scoped>\n.card.shadow-md { outline: 0; }\n</style>\n',
            },
        ],
        [
            'a Svelte :global block',
            {
                'src/Card.svelte':
                    '<style>:global(.card .shadow-md) { outline: 0; }</style>\n<div />\n',
            },
        ],
        [
            'an Astro page',
            {
                'src/pages/index.astro':
                    '---\n---\n<style is:global>.card.shadow-md{outline:0}</style>\n',
            },
        ],
        [
            'a Vue template',
            { 'src/Card.vue': '<template><div class="in-[.shadow-md]:p-2" /></template>\n' },
        ],
    ])(
        'keeps it when %s selects on it',
        async (_name, files) => {
            const [covered] = await build({ 'src/A.tsx': COVERED, ...files });
            expect(covered).toBe('card shadow-md shadow-lg');
        },
        60_000,
    );

    it('keeps it when a later file lowers a hook, on a build that reads its cache', async () => {
        // The prescan hands its result to the transform that follows; merged
        // before the later file's hook was read, it would ship the loss.
        const late = 'export const B = () => <b sz={{ group: { ".shadow-md": { p: 2 } } }} />;\n';
        const root = tailwindProject('csszyx-source-hooks-cache-', {
            'src/index.css': TW,
            'src/A.tsx': COVERED,
            'src/B.tsx': late,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const call = callHooks(
            vitePlugin({
                build: { parser },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', COVERED, join(root, 'src/A.tsx'))) as {
            code: string;
        };
        expect(result.code).toContain('card shadow-md shadow-lg');
    }, 60_000);

    it('reads no page in a directory the stylesheet walk also skips', async () => {
        // A coverage report or a built Storybook is output, not the app: its
        // `<style>` blocks select on nothing the app renders.
        const [covered] = await build({
            'src/A.tsx': COVERED,
            'coverage/index.html': REPORT_PAGE,
            'storybook-static/iframe.html': REPORT_PAGE,
        });
        expect(covered).toBe('card shadow-lg');
    }, 60_000);

    it('keeps it when a stylesheet applies a variant that selects on it', async () => {
        const root = tailwindProject('csszyx-source-hooks-apply-', {
            'src/index.css': `${TW}.card { @apply [&.shadow-md]:p-2; }\n`,
            'src/A.tsx': COVERED,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const call = callHooks(
            vitePlugin({
                build: { cache: false, parser },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', COVERED, join(root, 'src/A.tsx'))) as {
            code: string;
        };
        expect(result.code).toContain('card shadow-md shadow-lg');
    }, 60_000);
});

describe('a lane with no prescan', () => {
    it('reads every source for hooks at build start, before its first merge', async () => {
        const late = 'export const B = () => <b sz={{ group: { ".shadow-md": { p: 2 } } }} />;\n';
        const root = tailwindProject('csszyx-source-hooks-rollup-', {
            'src/index.css': TW,
            'src/A.tsx': COVERED,
            'src/B.tsx': 'export const B = () => <b className="group-[.shadow-md]:p-2" />;\n',
            'src/C.tsx': late,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const [pre] = rollupPlugin({
            build: { cache: false },
            production: { mangle: false },
        }) as unknown as Array<{
            buildStart: (this: unknown) => Promise<void>;
            transform: (this: unknown, code: string, id: string) => { code: string };
        }>;
        const ctx = { warn() {}, meta: {} };
        await pre?.buildStart.call(ctx);
        const result = pre?.transform.call(ctx, COVERED, join(root, 'src/A.tsx'));
        expect(result?.code).toContain('card shadow-md shadow-lg');
    }, 60_000);

    /**
     * Start a rollup build over the files and transform `src/A.tsx`.
     *
     * @param files - Files beside `src/index.css`.
     * @param build - Build options beyond the cache.
     * @param exclude - Paths the project leaves out.
     * @returns The emitted code.
     */
    async function rollupBuild(
        files: Record<string, string>,
        build: Record<string, unknown> = {},
        exclude?: string[],
    ): Promise<string | undefined> {
        const root = tailwindProject('csszyx-source-hooks-rollup-', {
            'src/index.css': TW,
            'src/A.tsx': COVERED,
            ...files,
        });
        // A file the walk lists and cannot read: gone between the two.
        symlinkSync(join(root, 'nowhere.vue'), join(root, 'src/Gone.vue'));
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const [pre] = rollupPlugin({
            exclude,
            build: { cache: false, ...build },
            production: { mangle: false },
        }) as unknown as Array<{
            buildStart: (this: unknown) => Promise<void>;
            transform: (this: unknown, code: string, id: string) => { code: string };
        }>;
        const ctx = { warn() {}, meta: {} };
        await pre?.buildStart.call(ctx);
        return pre?.transform.call(ctx, COVERED, join(root, 'src/A.tsx'))?.code;
    }

    it('reads the style blocks of every component at build start', async () => {
        const code = await rollupBuild({
            'src/Card.vue': SCOPED_STYLE,
        });
        expect(code).toContain('card shadow-md shadow-lg');
    }, 60_000);

    it('reads no component the project excludes', async () => {
        const code = await rollupBuild({ 'src/legacy/Card.vue': SCOPED_STYLE }, {}, [
            'src/legacy/**',
        ]);
        expect(code).toContain('card shadow-lg');
    }, 60_000);

    it('reads no page in a directory the stylesheet walk also skips', async () => {
        const code = await rollupBuild({
            'coverage/index.html': REPORT_PAGE,
            'target/doc/index.html': REPORT_PAGE,
        });
        expect(code).toContain('card shadow-lg');
    }, 60_000);

    it('reads nothing when the merge is off', async () => {
        const code = await rollupBuild({}, { mergeCoveredClasses: false });
        expect(code).toContain('card shadow-md shadow-lg');
    }, 60_000);
});

describe('a Vite dev server', () => {
    it.each([
        ['before', false],
        ['after', true],
    ])(
        'sends every module through again when an edit adds a hook, %s the page loads the table',
        async (_when, loaded) => {
            const root = tailwindProject('csszyx-source-hooks-dev-', {
                'src/index.css': TW,
                'src/A.tsx': COVERED,
            });
            vi.spyOn(process, 'cwd').mockReturnValue(root);
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            let invalidated = 0;
            const sent: unknown[] = [];
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
                watcher: { emit() {}, add() {}, on() {} },
                ws: { send: (message: unknown) => sent.push(message) },
                moduleGraph: graph,
                environments: { client: { moduleGraph: graph } },
            };
            const call = callHooks(
                vitePlugin({
                    build: { cache: false },
                    production: { mangle: false },
                }) as unknown as Record<string, unknown>[],
            );
            await call('configureServer', server);
            await call('configResolved', { root, command: 'serve' });
            const transform = async () =>
                ((await call('transform', COVERED, join(root, 'src/A.tsx'))) as { code: string })
                    .code;
            expect(await transform()).toContain('card shadow-lg');
            // Once the page has loaded the merge table, it is settled again too.
            if (loaded) await call('load', RESOLVED_UNSERVED_VIRTUAL_ID);

            const b = join(root, 'src/B.tsx');
            writeFileSync(b, 'export const B = () => <b className="group-[.shadow-md]:p-2" />;\n');
            await call('hotUpdate', { type: 'update', file: b, modules: [], server });
            // The reload is sent once the table settled again, after the hook returns.
            await expect
                .poll(() => sent, { timeout: 10_000 })
                .toContainEqual({ type: 'full-reload' });
            await expect.poll(() => invalidated, { timeout: 10_000 }).toBeGreaterThan(0);
            expect(await transform()).toContain('card shadow-md shadow-lg');
        },
        60_000,
    );

    it('reads the hooks of an edited file outside every walked folder', async () => {
        const root = tailwindProject('csszyx-source-hooks-dev-', {
            'src/index.css': TW,
            'src/A.tsx': COVERED,
        });
        // No walk owns a file beside the project, so no `.gitignore` decides
        // for it: its hooks are read, as the bundler transforms it anyway.
        const outside = tailwindProject('csszyx-source-hooks-outside-', {
            'B.tsx': 'export const B = () => <b />;\n',
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sent: unknown[] = [];
        const graph = {
            getModuleById: () => undefined,
            getModulesByFile: () => undefined,
            invalidateModule() {},
            invalidateAll() {},
        };
        const server = {
            config: { root },
            watcher: { emit() {}, add() {}, on() {} },
            ws: { send: (message: unknown) => sent.push(message) },
            moduleGraph: graph,
            environments: { client: { moduleGraph: graph } },
        };
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configureServer', server);
        await call('configResolved', { root, command: 'serve' });
        const transform = async () =>
            ((await call('transform', COVERED, join(root, 'src/A.tsx'))) as { code: string }).code;
        expect(await transform()).toContain('card shadow-lg');

        const b = join(outside, 'B.tsx');
        writeFileSync(b, 'export const B = () => <b className="group-[.shadow-md]:p-2" />;\n');
        await call('hotUpdate', { type: 'update', file: b, modules: [], server });
        await expect.poll(() => sent, { timeout: 10_000 }).toContainEqual({ type: 'full-reload' });
        expect(await transform()).toContain('card shadow-md shadow-lg');
    }, 60_000);
});

describe('a Vite dev server whose root is a link', () => {
    it.each([
        ['under the root as given', (linked: string, _real: string) => linked],
        ['under its real path, as Vite names a module', (_linked: string, real: string) => real],
    ])(
        'reads no hooks from an edited gitignored file %s',
        async (_name, base) => {
            const real = tailwindProject('csszyx-source-hooks-link-', {
                '.gitignore': 'generated/\n',
                'src/index.css': TW,
                'src/A.tsx': COVERED,
                'generated/B.tsx': 'export const B = () => <b />;\n',
            });
            const linked = `${real}-link`;
            symlinkSync(real, linked, 'dir');
            linkedRoots.push(linked);
            vi.spyOn(process, 'cwd').mockReturnValue(linked);
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const graph = {
                getModuleById: () => undefined,
                getModulesByFile: () => undefined,
                invalidateModule() {},
                invalidateAll() {},
            };
            const server = {
                config: { root: linked },
                watcher: { emit() {}, add() {}, on() {} },
                ws: { send() {} },
                moduleGraph: graph,
                environments: { client: { moduleGraph: graph } },
            };
            const call = callHooks(
                vitePlugin({
                    build: { cache: false },
                    production: { mangle: false },
                }) as unknown as Record<string, unknown>[],
            );
            await call('configureServer', server);
            await call('configResolved', { root: linked, command: 'serve' });
            const transform = async () =>
                ((await call('transform', COVERED, join(linked, 'src/A.tsx'))) as { code: string })
                    .code;
            expect(await transform()).toContain('card shadow-lg');

            const b = join(base(linked, real), 'generated/B.tsx');
            writeFileSync(b, 'export const B = () => <b className="group-[.shadow-md]:p-2" />;\n');
            await call('hotUpdate', { type: 'update', file: b, modules: [], server });
            // The hooks of a file the watcher reports are read before the hook
            // returns, so the merge already answers without them.
            expect(await transform()).toContain('card shadow-lg');
        },
        60_000,
    );
});

describe('the source hook registry', () => {
    it('tells an edit to a style block’s attribute selector from a read of the same text', () => {
        const scan: ContentScanner = () => [];
        const registry = new SourceHookRegistry(() => scan);
        expect(registry.readText('a.vue', '<style>[class~="x"]{}</style>', 'vue')).toBe(true);
        expect(registry.readText('a.vue', '<style>[class~="x"]{}</style>', 'vue')).toBe(false);
        expect(registry.readText('a.vue', '<style>[class~="y"]{}</style>', 'vue')).toBe(true);
        expect(registry.readText('a.vue', '<style>[class~="y"] {}</style>', 'vue')).toBe(false);
    });

    /** A model whose every candidate selects on its own name, to read the union back. */
    const echoModel = {
        variantHooks: (candidates: readonly string[]) => ({
            names: new Set(candidates),
            attributes: [],
        }),
    } as unknown as ProjectStyleModel;
    /**
     * Tailwind's extractor, cut down to whitespace-separated words.
     *
     * @param files - The texts.
     * @returns Every word in them.
     */
    const words: ContentScanner = files => files.flatMap(file => file.content.split(/\s+/));
    const FILES = [
        { file: 'a.tsx', text: 'hover:p-1 p-2 group-[.x]:p-3', extension: 'tsx' },
        { file: 'b.vue', text: 'focus:p-4 <style>.card.shadow-md{}</style>', extension: 'vue' },
        { file: 'c.tsx', text: 'hover:p-1', extension: 'tsx' },
    ];
    const namesOf = (registry: SourceHookRegistry) =>
        [...registry.hooksFor(echoModel).names].sort();

    it('reads many files with one scan, and hands the model what reading each would', () => {
        const scan = vi.fn(words);
        const batched = new SourceHookRegistry(() => scan);
        expect(batched.readTexts(FILES)).toBe(true);
        expect(scan).toHaveBeenCalledTimes(1);

        const single = new SourceHookRegistry(() => words);
        for (const { file, text, extension } of FILES) single.readText(file, text, extension);
        expect(namesOf(batched)).toEqual(namesOf(single));
        expect(namesOf(batched)).toEqual(
            ['card', 'focus:p-4', 'group-[.x]:p-3', 'hover:p-1', 'shadow-md'].sort(),
        );
    });

    it('scans nothing for a batch whose files it already read', () => {
        const scan = vi.fn(words);
        const registry = new SourceHookRegistry(() => scan);
        registry.readTexts(FILES);
        expect(registry.readTexts(FILES)).toBe(false);
        expect(registry.readTexts([])).toBe(false);
        expect(scan).toHaveBeenCalledTimes(1);
        for (const { file, text, extension } of FILES) {
            expect(registry.readText(file, text, extension)).toBe(false);
        }
        expect(scan).toHaveBeenCalledTimes(1);
    });

    it('reads a file edited after a batch on its own, and keeps what the batch found', () => {
        // Tailwind's own dev server keeps every candidate it has seen until a
        // restart; a batch does the same, which keeps a class, never drops one.
        const scan = vi.fn(words);
        const registry = new SourceHookRegistry(() => scan);
        registry.readTexts(FILES);
        expect(registry.readText('a.tsx', 'peer-[.y]:p-5', 'tsx')).toBe(true);
        expect(scan).toHaveBeenCalledTimes(2);
        expect(scan).toHaveBeenLastCalledWith([{ content: 'peer-[.y]:p-5', extension: 'tsx' }]);
        expect(namesOf(registry)).toContain('peer-[.y]:p-5');
        expect(namesOf(registry)).toContain('group-[.x]:p-3');
    });

    it('reads a batch without Tailwind’s extractor as it reads each file', () => {
        const batched = new SourceHookRegistry(() => null);
        batched.readTexts(FILES);
        const single = new SourceHookRegistry(() => null);
        for (const { file, text, extension } of FILES) single.readText(file, text, extension);
        expect(namesOf(batched)).toEqual(namesOf(single));
        expect(namesOf(batched)).toContain('group-[.x]:p-3');
    });
});

describe('a lane that learns of a hook after it merged', () => {
    it('stops the build for a hook only Tailwind’s own scan reaches', async () => {
        // `@source` names a directory the project walk does not visit; the
        // build reads Tailwind's scan of it once every module is transformed.
        const root = tailwindProject('csszyx-source-hooks-scan-', {
            'app/src/index.css': `${TW}@source "../../lib";\n`,
            'app/src/A.tsx': COVERED,
            'lib/B.html': '<b class="group-[.shadow-md]:p-2"></b>\n',
        });
        const app = join(root, 'app');
        linkTailwindIntegration(app);
        vi.spyOn(process, 'cwd').mockReturnValue(app);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root: app, command: 'build' });
        await call('transform', COVERED, join(app, 'src/A.tsx'));
        await expect(call('renderStart')).rejects.toThrow(
            expect.objectContaining({
                code: 'merge-hook-late',
                message: expect.stringMatching(
                    /^\[csszyx\] merge-hook-late: src\/A\.tsx\n {2}`shadow-md` was removed from this file/,
                ),
            }),
        );
    }, 60_000);

    it('stops the build and names the class, the file and the switch', async () => {
        const root = tailwindProject('csszyx-source-hooks-late-', {
            'src/index.css': TW,
            'src/A.tsx': COVERED,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        const merged = (await call('transform', COVERED, join(root, 'src/A.tsx'))) as {
            code: string;
        };
        expect(merged.code).toContain('card shadow-lg');
        // A module the prescan never saw arrives after the merge.
        const late = 'export const B = () => <b sz={{ group: { ".shadow-md": { p: 2 } } }} />;\n';
        writeFileSync(join(root, 'src/B.tsx'), late);
        await call('transform', late, join(root, 'src/B.tsx'));
        await expect(call('renderStart')).rejects.toThrow(
            expect.objectContaining({
                code: 'merge-hook-late',
                args: { className: 'shadow-md' },
                message:
                    '[csszyx] merge-hook-late: src/A.tsx\n' +
                    '  `shadow-md` was removed from this file before csszyx read a rule that selects on it, so the page would lose that class, and the build stops.\n' +
                    '  help: set `build.mergeCoveredClasses: false` to keep every class, or restart the watch session.\n' +
                    '  note: csszyx reads such rules during the prescan, before it merges; this one came later, from a module the prescan did not reach or from an edit during a watch session.\n' +
                    '  docs: https://csszyx.com/e/merge-hook-late',
            }),
        );
    }, 60_000);
});

describe('the table a Next command writes', () => {
    /**
     * The merge table a Next command writes for this census.
     *
     * @param classes - The census.
     * @param files - Source files beside the stylesheet, handed over as sources.
     * @returns The table module's text.
     */
    async function tableOf(classes: string[], files: Record<string, string> = {}) {
        const root = tailwindProject('csszyx-source-hooks-next-', {
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': TW,
            ...files,
        });
        const facts = await prepareNextStylesheetFacts({ explicitRoot: root });
        writeMergeRegistration({
            root,
            model: facts.model,
            classes,
            authoredClasses: [],
            mergeLiterals: [],
            // A file listed and gone before the table is written.
            sources: [...Object.keys(files).map(file => join(root, file)), join(root, 'gone.tsx')],
        });
        return readFileSync(join(root, '.csszyx', MERGE_TABLE_FILE), 'utf8');
    }

    it('gives no signature to a class a lowered variant selects on', async () => {
        const table = await tableOf(['pb-2', 'px-2', 'p-4', 'group-[.pb-2]:m-1']);
        expect(table).toContain('"px-2"');
        expect(table).not.toContain('"pb-2"');
    }, 60_000);

    it('gives none to a class a `<style jsx>` block selects on', async () => {
        const table = await tableOf(['pb-2', 'px-2', 'p-4'], {
            'app/card.tsx':
                'export const C = () => <><style jsx>{`.card.pb-2 { outline: 0; }`}</style></>;\n',
        });
        expect(table).toContain('"px-2"');
        expect(table).not.toContain('"pb-2"');
    }, 60_000);
});

describe('the merge audit', () => {
    it('lists nothing a hook in another file keeps', async () => {
        const root = tailwindProject('csszyx-source-hooks-audit-', { 'src/index.css': TW });
        const model = await openProjectStyleModel(root, [join(root, 'src/index.css')]);
        const late = 'export const B = () => <b sz={{ group: { ".shadow-md": { p: 2 } } }} />;\n';
        const files = [
            { path: join(root, 'src/A.tsx'), relative: 'src/A.tsx', source: COVERED },
            { path: join(root, 'src/B.tsx'), relative: 'src/B.tsx', source: late },
        ];
        expect(auditMerges({ model, classPrefix: null, files: files.slice(0, 1) })).toEqual([
            { file: 'src/A.tsx', line: 1, kind: 'merge-covered-class', className: 'shadow-md' },
        ]);
        expect(auditMerges({ model, classPrefix: null, files })).toEqual([]);
    }, 60_000);
});
