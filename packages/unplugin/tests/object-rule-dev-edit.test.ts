/**
 * The object rule following a stylesheet edit on a dev server.
 *
 * A static `sz` object is merged when its module is transformed, from the
 * style model open at that moment. Vite keeps a transformed module until it is
 * invalidated, so a stylesheet edit that changes which class covers which has
 * to send every module through the transform again — reloading the page alone
 * would serve the classes merged under the old stylesheet.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { rollupPlugin, vitePlugin } from '../src/unplugin.js';
import { RESOLVED_UNSERVED_VIRTUAL_ID } from '../src/virtual-modules.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const APP = 'export const App = () => <div sz={{ pb: "brand", p: 4 }} />;\n';
const WITH_TOKEN = '@import "tailwindcss";\n@theme {\n  --spacing-brand: 3px;\n}\n';
const WITHOUT_TOKEN = '@import "tailwindcss";\n';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * The class lists the emitted code carries, in order.
 *
 * @param code - Emitted module code.
 * @returns Each `className` string literal.
 */
function classNames(code: string): string[] {
    return [...code.matchAll(/className[=:]\s*"([^"]*)"/g)].map(match => match[1] as string);
}

/**
 * A dev server that has transformed the component once, recording what it
 * tells the page.
 *
 * @param options - How the server starts.
 * @param options.loadTable - Whether a page has loaded the table module.
 * @returns The handles a case drives it with.
 */
async function devServer({ loadTable = true } = {}) {
    const root = tailwindProject('csszyx-object-rule-dev-', {
        'src/index.css': WITH_TOKEN,
        'src/App.tsx': APP,
    });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
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
    await call('configResolved', { root, command: 'serve' });

    const app = join(root, 'src/App.tsx');
    const transform = async () =>
        classNames(((await call('transform', APP, app)) as { code: string }).code);
    expect(await transform()).toEqual(['p-4']);

    const counts = { invalidatedAll: 0 };
    const graph = {
        getModuleById: () => undefined,
        getModulesByFile: () => undefined,
        invalidateModule() {},
        invalidateAll() {
            counts.invalidatedAll++;
        },
    };
    const sent: unknown[] = [];
    const server = {
        config: { root },
        watcher: { emit() {} },
        ws: { send: (message: unknown) => sent.push(message) },
        moduleGraph: graph,
        environments: { client: { moduleGraph: graph } },
    };
    // A running dev server's page has loaded the table module; one whose first
    // page has not yet asked for it has not.
    if (loadTable) await call('load', RESOLVED_UNSERVED_VIRTUAL_ID);
    const edit = async (content: string) => {
        const css = join(root, 'src/index.css');
        writeFileSync(css, content, 'utf8');
        await call('hotUpdate', { type: 'update', file: css, modules: [], server });
    };
    return { edit, transform, counts, sent, warnings };
}

describe('the object rule on a dev server', () => {
    it('transforms every module again when a stylesheet edit changes what covers what', async () => {
        const dev = await devServer();

        await dev.edit(WITHOUT_TOKEN);

        expect(dev.counts.invalidatedAll).toBeGreaterThan(0);
        expect(dev.sent).toContainEqual({ type: 'full-reload' });
        expect(await dev.transform()).toEqual(['pb-brand p-4']);
        // A reload that drops the page's state says why, as the prefix one does.
        expect(dev.warnings.join('\n')).toContain(
            'src/index.css changed which sz keys cover each other: recompiled every module and reloaded the page.',
        );
    }, 120_000);

    it('recompiles before any page has loaded the table module', async () => {
        const dev = await devServer({ loadTable: false });

        await dev.edit(WITHOUT_TOKEN);

        expect(dev.counts.invalidatedAll).toBeGreaterThan(0);
        expect(await dev.transform()).toEqual(['pb-brand p-4']);
    }, 120_000);

    it('keeps the hot update for an edit that leaves every merge alone', async () => {
        const dev = await devServer();

        await dev.edit(`${WITH_TOKEN}.card { color: red; }\n`);

        expect(dev.counts.invalidatedAll).toBe(0);
        expect(dev.sent).not.toContainEqual({ type: 'full-reload' });
        expect(dev.warnings.join('\n')).not.toContain('cover each other');
    }, 120_000);
});

describe('the object rule during a rollup watch session', () => {
    /**
     * A rollup watch session that has transformed the component once.
     *
     * @returns A caller for one hook by name, the stylesheet, and every warning.
     */
    async function watchSession() {
        const root = tailwindProject('csszyx-object-rule-watch-', {
            'src/index.css': WITH_TOKEN,
            'src/App.tsx': APP,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const warnings: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            warnings.push(args.map(String).join(' '));
        });
        const call = callHooks(
            [
                rollupPlugin({ build: { cache: false }, production: { mangle: false } }),
            ].flat() as unknown as Record<string, unknown>[],
        );
        await call('buildStart');
        const result = (await call('transform', APP, join(root, 'src/App.tsx'))) as {
            code: string;
        };
        expect(classNames(result.code)).toEqual(['p-4']);
        return { call, css: join(root, 'src/index.css'), warnings };
    }

    it('says to restart when a stylesheet edit changes what covers what', async () => {
        const session = await watchSession();

        writeFileSync(session.css, WITHOUT_TOKEN);
        await expect(session.call('buildStart')).resolves.toBeUndefined();

        expect(session.warnings.join('\n')).toContain(
            'src/index.css changed which sz keys cover each other',
        );
    }, 60_000);

    it('rebuilds quietly for an edit that leaves every merge alone', async () => {
        const session = await watchSession();

        writeFileSync(session.css, `${WITH_TOKEN}.card { color: red; }\n`);
        await expect(session.call('buildStart')).resolves.toBeUndefined();

        expect(session.warnings.join('\n')).not.toContain('cover each other');
    }, 60_000);
});
