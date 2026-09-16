/**
 * The Next Turbopack lane lowers `sz` with the project's Tailwind prefix.
 *
 * The loader runs synchronously, so it reads the prefix from the facts file
 * `csszyx next prebuild` and `csszyx next watch` write, and declares that file
 * and every stylesheet it records as dependencies: an edit re-runs the loader.
 * A project with no stylesheet that could reach Tailwind has no prefix to read,
 * so it needs no file. A dev loader that can wait reads the stylesheets itself;
 * a production loader whose facts no longer describe them stops.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runNextPrebuild } from '../src/next-prebuild.js';
import {
    resolveNextStylesheetFactsPath,
    writeNextStylesheetFacts,
} from '../src/next-stylesheet-facts.js';
import nextTurboLoader, {
    type NextTurboLoaderContext,
    runNextTurboLoader,
} from '../src/next-turbo-loader.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const APP = 'export const App = () => <div sz={{ p: 4 }} />;\n';
const PREFIXED = '@import "tailwindcss" prefix(tw);\n';
const IDENTITY = {
    nextVersion: '16.2.7',
    csszyxVersion: '0.9.0',
    compilerVersion: '0.9.0',
    nativeVersion: '0.9.0-test',
};
const OPTIONS = {
    parserMode: 'auto' as never,
    config: { mangleVars: false },
    writeOptions: { retryDelayMs: 0 },
    ...IDENTITY,
};

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * A Next app whose global stylesheet is the given CSS.
 *
 * @param css - `app/globals.css`.
 * @param extra - More files, relative to the root.
 * @returns The root, the page path and the csszyx cache directory.
 */
function app(
    css: string,
    extra: Record<string, string> = {},
): { root: string; page: string; cacheDir: string } {
    const root = tailwindProject('csszyx-next-prefix-', {
        'package.json': '{ "name": "app" }\n',
        'app/globals.css': css,
        'app/page.tsx': APP,
        ...extra,
    });
    return { root, page: join(root, 'app/page.tsx'), cacheDir: join(root, '.csszyx/cache') };
}

/**
 * A loader context that records its dependencies.
 *
 * @param root - App root.
 * @param page - The module being loaded.
 * @param mode - The Next build mode.
 * @returns The context, with the dependencies it was given.
 */
function loaderContext(
    root: string,
    page: string,
    mode: 'development' | 'production' = 'development',
): NextTurboLoaderContext & { dependencies: string[] } {
    const dependencies: string[] = [];
    return {
        resourcePath: page,
        rootContext: root,
        context: join(root, 'app'),
        mode,
        addDependency: (file: string) => dependencies.push(file),
        dependencies,
    };
}

describe('the Next Turbopack loader and the Tailwind prefix', () => {
    it('lowers with the recorded prefix, and depends on the facts and the stylesheet', async () => {
        const { root, page, cacheDir } = app(PREFIXED);
        await writeNextStylesheetFacts({ root, cacheDir });
        const ctx = loaderContext(root, page);

        const result = runNextTurboLoader(APP, ctx, OPTIONS);

        expect(result.code).toContain('tw:p-4');
        expect(ctx.dependencies).toContain(resolveNextStylesheetFactsPath(cacheDir));
        expect(ctx.dependencies).toContain(join(root, 'app/globals.css'));
    }, 60_000);

    it('needs no facts when no stylesheet reaches Tailwind', () => {
        const { root, page } = app('.card { color: red; }\n');

        const result = runNextTurboLoader(APP, loaderContext(root, page), OPTIONS);

        expect(result.code).toContain('p-4');
        expect(result.code).not.toContain('tw:');
    }, 60_000);

    it('refuses a synchronous run with no facts for a stylesheet that reaches Tailwind', () => {
        const { root, page } = app(PREFIXED);

        expect(() => runNextTurboLoader(APP, loaderContext(root, page), OPTIONS)).toThrow(
            /Tailwind prefix[\s\S]*csszyx next prebuild/,
        );
    }, 60_000);

    it('reads the stylesheets itself on a dev loader that can wait', async () => {
        const { root, page, cacheDir } = app(PREFIXED);
        const ctx = loaderContext(root, page);

        const code = await new Promise<string | undefined>((resolve, reject) => {
            Object.assign(ctx, {
                getOptions: () => OPTIONS,
                async: () => (error: Error | null, output?: string) =>
                    error ? reject(error) : resolve(output),
            });
            const returned = nextTurboLoader.call(ctx, APP);
            if (returned !== undefined) resolve(returned);
        });

        expect(code).toContain('tw:p-4');
        expect(existsSync(resolveNextStylesheetFactsPath(cacheDir))).toBe(true);
    }, 60_000);

    /**
     * Load a module through the loader entry, as Turbopack does in \`next dev\`.
     *
     * @param ctx - A loader context that may wait.
     * @returns The transformed code.
     */
    function loadAsync(ctx: NextTurboLoaderContext): Promise<string | undefined> {
        return new Promise((resolve, reject) => {
            Object.assign(ctx, {
                getOptions: () => OPTIONS,
                async: () => (error: Error | null, output?: string) =>
                    error ? reject(error) : resolve(output),
            });
            const returned = nextTurboLoader.call(ctx, APP);
            if (returned !== undefined) resolve(returned);
        });
    }

    it('reads the stylesheets once for modules that ask at the same time', async () => {
        const { root, page } = app(PREFIXED);

        const [first, second] = await Promise.all([
            loadAsync(loaderContext(root, page)),
            loadAsync(loaderContext(root, page)),
        ]);

        expect(first).toContain('tw:p-4');
        expect(second).toContain('tw:p-4');
    }, 60_000);

    it('hands the loader callback the error when the stylesheets cannot give one prefix', async () => {
        const { root, page } = app(PREFIXED, { 'legacy/old.css': '@import "tailwindcss";\n' });

        await expect(loadAsync(loaderContext(root, page))).rejects.toThrow(
            'set different prefixes',
        );
    }, 60_000);

    it('warns about a stray stylesheet that did not compile, and still loads', async () => {
        const { root, page } = app(PREFIXED, { 'legacy/old.css': '@import "./gone.css";\n' });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await loadAsync(loaderContext(root, page))).toContain('tw:p-4');
        expect(warn.mock.calls.map(args => args.join(' ')).join('\n')).toContain(
            'never reached Tailwind',
        );
    }, 60_000);

    it('stops a production loader whose facts no longer describe the stylesheets', async () => {
        const { root, page, cacheDir } = app(PREFIXED);
        await writeNextStylesheetFacts({ root, cacheDir });
        runNextPrebuild({
            files: [page],
            explicitRoot: root,
            cwd: root,
            mode: 'production',
            ...OPTIONS,
        });

        writeFileSync(join(root, 'app/globals.css'), '@import "tailwindcss";\n');

        expect(() =>
            runNextTurboLoader(APP, loaderContext(root, page, 'production'), {
                ...OPTIONS,
                mode: 'production',
            }),
        ).toThrow(/app\/globals\.css changed/);
    }, 60_000);
});

describe('the Next prebuild and the Tailwind prefix', () => {
    it('safelists the classes under the recorded prefix', async () => {
        const { root, page, cacheDir } = app(PREFIXED);
        await writeNextStylesheetFacts({ root, cacheDir });

        const result = runNextPrebuild({
            files: [page],
            explicitRoot: root,
            cwd: root,
            ...OPTIONS,
        });

        expect(readFileSync(result.safelistOutputPath, 'utf8').split('\n')).toContain('tw:p-4');
    }, 60_000);

    it('stops without recorded facts for a stylesheet that reaches Tailwind', () => {
        const { root, page } = app(PREFIXED);

        expect(() =>
            runNextPrebuild({ files: [page], explicitRoot: root, cwd: root, ...OPTIONS }),
        ).toThrow(/the Next prebuild has not read the Tailwind prefix[\s\S]*csszyx next prebuild/);
    }, 60_000);
});
