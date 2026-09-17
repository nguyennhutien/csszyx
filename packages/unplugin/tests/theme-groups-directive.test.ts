/**
 * The theme-group import never goes above a module's directive prologue.
 *
 * Next.js compiles a module whose `'use client'` is not its first statement
 * as an error ("The \"use client\" directive must be placed before other
 * expressions"), and the error stops every route of the dev server. The
 * other generated imports already go after the prologue; this one was
 * prepended, so any client component calling `szcn` broke a Next webpack app.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { _resetThemeGroupsFileCache } from '../src/theme-groups-file.js';
import { unplugin as rawInstance, vitePlugin } from '../src/unplugin.js';
import { callHooks } from './tailwind-project.js';

const roots: string[] = [];
afterEach(() => {
    _resetThemeGroupsFileCache();
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CLIENT = [
    "'use client';",
    "import { szcn } from '@csszyx/runtime';",
    "export const Box = ({ c }: { c: string }) => <div className={szcn('gap-2', c)} />;",
    '',
].join('\n');

/**
 * A project declaring one groupable token.
 *
 * @returns Its root.
 */
function project(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-directive-')));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
        join(root, 'src/theme.css'),
        '@import "tailwindcss";\n@theme { --color-brand: #2dd597; }\n',
    );
    return root;
}

describe('the theme-group import in a client component', () => {
    it('goes after the directive on the webpack lane', async () => {
        const root = project();
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const plugin = rawInstance.raw(
            { build: { cache: false }, production: { mangle: false } },
            { framework: 'webpack' },
        ) as unknown as {
            webpack: (compiler: unknown) => void;
            transform:
                | { handler: (code: string, id: string) => unknown }
                | ((code: string, id: string) => unknown);
        };
        // A compiler that runs what it is given, as a compilation does; the
        // plugin reads the project's theme in `beforeCompile`.
        const pending: Promise<unknown>[] = [];
        plugin.webpack({
            context: root,
            options: { mode: 'development' },
            hooks: {
                beforeCompile: {
                    tap: (_n: string, run: () => void) => run(),
                    tapPromise: (_n: string, run: () => Promise<unknown>) => {
                        pending.push(run());
                    },
                },
                thisCompilation: { tap: () => undefined },
            },
        });
        await Promise.all(pending);
        const transform =
            typeof plugin.transform === 'function' ? plugin.transform : plugin.transform.handler;

        const output = (await transform.call({}, CLIENT, join(root, 'src/Box.tsx'))) as
            | { code: string }
            | string;
        const code = typeof output === 'string' ? output : output.code;

        expect(code).toContain('theme-groups.mjs');
        expect(code.trimStart().startsWith("'use client'")).toBe(true);
    }, 60_000);

    it('goes after the directive on the Vite lane', async () => {
        const root = project();
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'serve' });

        const output = (await call('transform', CLIENT, join(root, 'src/Box.tsx'))) as {
            code: string;
        };

        expect(output.code).toContain('virtual:csszyx/theme-groups');
        expect(output.code.trimStart().startsWith("'use client'")).toBe(true);
    }, 60_000);
});

describe('the merge table on the webpack lane', () => {
    // Next compiles every page in several webpack layers, each with its own
    // copy of the runtime, and adds its entries itself: a registration
    // prepended to the configured entries reached none of the copies a page
    // renders with, so `szcn` merged nothing on the server or in the browser.
    // Imported from each module that loads the runtime, it lands in the layer
    // of that module.
    it('is imported by every module that loads the runtime, after its directive', async () => {
        const root = project();
        mkdirSync(join(root, 'node_modules/@csszyx'), { recursive: true });
        writeFileSync(join(root, 'package.json'), '{ "name": "app" }\n');
        symlinkSync(
            join(import.meta.dirname, '../../runtime'),
            join(root, 'node_modules/@csszyx/runtime'),
            'dir',
        );
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const plugin = rawInstance.raw(
            { build: { cache: false }, production: { mangle: false } },
            { framework: 'webpack' },
        ) as unknown as {
            webpack: (compiler: unknown) => void;
            transform:
                | { handler: (code: string, id: string) => unknown }
                | ((code: string, id: string) => unknown);
        };
        const pending: Promise<unknown>[] = [];
        plugin.webpack({
            context: root,
            options: { mode: 'development', entry: {} },
            hooks: {
                beforeCompile: {
                    tap: (_n: string, run: () => void) => run(),
                    tapPromise: (_n: string, run: () => Promise<unknown>) => {
                        pending.push(run());
                    },
                },
                thisCompilation: { tap: () => undefined },
                entryOption: { tap: () => undefined },
                afterEnvironment: { tap: () => undefined },
                environment: { tap: () => undefined },
            },
        });
        await Promise.all(pending);
        const transform =
            typeof plugin.transform === 'function' ? plugin.transform : plugin.transform.handler;

        const output = (await transform.call({}, CLIENT, join(root, 'src/Box.tsx'))) as
            | { code: string }
            | string;
        const code = typeof output === 'string' ? output : output.code;

        expect(code).toContain("import '../.csszyx/unserved-runtime.mjs';");
        expect(code.trimStart().startsWith("'use client'")).toBe(true);

        // A module transformed twice, as a loader chain can, imports it once.
        const again = (await transform.call({}, code, join(root, 'src/Box.tsx'))) as
            | { code: string }
            | string
            | null;
        let twice = code;
        if (typeof again === 'string') twice = again;
        else if (again !== null) twice = again.code;
        expect(twice.split("import '../.csszyx/unserved-runtime.mjs';")).toHaveLength(2);
    }, 60_000);
});
