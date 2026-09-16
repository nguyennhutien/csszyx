/**
 * A dev server follows a Tailwind prefix that changes while it runs.
 *
 * Every module the server compiled before the edit carries classes under the
 * old prefix, and the page holds them. Swapping the stylesheet alone leaves
 * every one of those classes unstyled, so a prefix change recompiles every
 * module, rewrites the safelist and reloads the page, and says so. A stylesheet
 * edit that leaves the prefix alone keeps its ordinary hot update.
 *
 * An edit that breaks the stylesheets mid-session must not kill the server:
 * the author is typing, and the next save usually fixes it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SAFELIST_FILE } from '../src/safelist-source.js';
import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const APP = 'export const App = () => <div sz={{ p: 4 }} />;\n';
const STOCK = '@import "tailwindcss";\n';
const PREFIXED = '@import "tailwindcss" prefix(tw);\n';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * A running dev server over a stock project, with a recording stand-in for the
 * parts of Vite's server the hot update touches.
 *
 * @param options - How the stand-in server is shaped.
 * @param options.environments - Whether it has per-environment graphs, which
 *        Vite 5 does not.
 * @param options.start - Whether the build hook runs before the first edit.
 * @returns The hook caller, the project root, and what the server was told.
 */
async function devServer({ environments = true, start = true } = {}) {
    const root = tailwindProject('csszyx-prefix-hmr-', {
        'src/index.css': STOCK,
        'src/App.tsx': APP,
    });
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
    });
    const call = callHooks(
        vitePlugin({ build: { cache: false }, production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[],
    );
    if (start) await call('configResolved', { root, command: 'serve' });

    const sent: unknown[] = [];
    let invalidatedAll = 0;
    const graph = {
        getModuleById: () => null,
        invalidateModule() {},
        getModulesByFile: () => undefined,
        invalidateAll() {
            invalidatedAll += 1;
        },
    };
    const server = {
        config: { root },
        watcher: { emit() {} },
        ws: { send: (message: unknown) => sent.push(message) },
        moduleGraph: graph,
        ...(environments ? { environments: { client: { moduleGraph: graph } } } : {}),
    };
    const edit = async (file: string, css: string, hook = 'hotUpdate') => {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), css, 'utf8');
        await call(hook, { type: 'update', file: join(root, file), modules: [], server });
    };
    const transformApp = async () =>
        ((await call('transform', APP, join(root, 'src/App.tsx'))) as { code: string }).code;
    return { root, edit, transformApp, sent, warnings, invalidated: () => invalidatedAll };
}

describe('a Tailwind prefix that changes during a dev session', () => {
    it('recompiles every module, rewrites the safelist, reloads the page and says so', async () => {
        const dev = await devServer();

        await dev.edit('src/index.css', PREFIXED);

        expect(dev.sent).toContainEqual({ type: 'full-reload' });
        expect(dev.invalidated()).toBeGreaterThan(0);
        expect(dev.warnings.join('\n')).toContain(
            'src/index.css changed the Tailwind prefix from no prefix to `tw`',
        );
        expect(await dev.transformApp()).toContain('tw:p-4');
        expect(readFileSync(join(dev.root, SAFELIST_FILE), 'utf8').split('\n')).toContain('tw:p-4');
    }, 60_000);

    it('keeps the ordinary hot update for an edit that leaves the prefix alone', async () => {
        const dev = await devServer();

        await dev.edit('src/index.css', `${STOCK}.card { color: red; }\n`);

        expect(dev.sent).not.toContainEqual({ type: 'full-reload' });
        expect(dev.invalidated()).toBe(0);
    }, 60_000);

    it('warns and keeps the prefix it last read when an edit leaves the entries disagreeing', async () => {
        const dev = await devServer();

        await dev.edit('legacy/old.css', '@import "tailwindcss" prefix(old);\n');

        expect(dev.warnings.join('\n')).toContain('set different prefixes');
        expect(dev.warnings.join('\n')).toContain('keeps the prefix it last read');
        expect(dev.sent).not.toContainEqual({ type: 'full-reload' });
        expect(await dev.transformApp()).not.toContain('tw:');
    }, 60_000);

    it('follows the change on the hook Vite 5 calls', async () => {
        const dev = await devServer({ environments: false });

        await dev.edit('src/index.css', PREFIXED, 'handleHotUpdate');

        expect(dev.sent).toContainEqual({ type: 'full-reload' });
        expect(await dev.transformApp()).toContain('tw:p-4');
    }, 60_000);

    it('stays silent for a server whose build never read the stylesheets', async () => {
        const dev = await devServer({ start: false });

        await dev.edit('src/index.css', PREFIXED);

        expect(dev.sent).not.toContainEqual({ type: 'full-reload' });
        expect(dev.warnings.join('\n')).not.toContain('changed the Tailwind prefix');
    }, 60_000);
});
