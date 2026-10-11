/**
 * A stylesheet edit on a running Vite dev server that adds an aliased
 * `@import` brings the imported theme in without a restart.
 *
 * The stylesheet walk is synchronous and Vite's resolver is not: the edit's
 * walk meets the new target before Vite has answered it. The style model the
 * edit opens asks Vite then, and walks again with the answer; without that,
 * a gitignored `@theme` file reached only through the alias would stay out of
 * the merge groups until the server restarts. The page's reload is decided
 * after that answer, in the same edit: a token the edit brought in changes
 * the registration the page booted with.
 *
 * Vite's resolver keeps a miss for its life, so a stylesheet created after a
 * failed lookup is asked again of a new one when the watcher reports it.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import { vitePlugin } from '../src/unplugin.js';

/** The specifier the plugin injects, resolved by its own `resolveId`. */
const THEME_GROUPS_VIRTUAL = 'virtual:csszyx/theme-groups';

const servers: ViteDevServer[] = [];
const roots: string[] = [];

afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Ask the dev server for the generated module as it stands right now.
 *
 * @param server - Running dev server.
 * @returns The module source, or an empty string when it is not resolvable.
 */
async function readGeneratedModule(server: ViteDevServer): Promise<string> {
    const result = await server.transformRequest(THEME_GROUPS_VIRTUAL);
    return result?.code ?? '';
}

const BRAND = "@import 'tailwindcss';\n@theme { --color-brand: oklch(0.7 0.1 250); }\n";
const TOKENS = '@theme { --color-accent: oklch(0.6 0.2 25); }\n';

/**
 * A project whose stylesheet defines `brand`, with a gitignored folder only an
 * aliased import reaches, and a running dev server over it.
 *
 * @param stylesheetText - The stylesheet the server starts on.
 * @param tokens - Whether the aliased stylesheet exists at start.
 * @returns The root, the stylesheet's path, the server, and every page reload
 *          it sent, in order.
 */
async function serveAliasProject(
    stylesheetText: string,
    tokens: boolean,
): Promise<{ root: string; stylesheet: string; server: ViteDevServer; reloads: string[] }> {
    loadNativeBinding();
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-vite-alias-live-')));
    roots.push(root);
    mkdirSync(join(root, 'src/gen'), { recursive: true });
    // Gitignored: only the import brings it into the walk.
    writeFileSync(join(root, '.gitignore'), 'src/gen/\n');
    if (tokens) writeFileSync(join(root, 'src/gen/tokens.css'), TOKENS);
    const stylesheet = join(root, 'src/theme.css');
    writeFileSync(stylesheet, stylesheetText);
    writeFileSync(
        join(root, 'src/main.ts'),
        "import { szcn } from '@csszyx/runtime';\nexport const merged = szcn('text-brand', 'text-accent');\n",
    );

    const server = await createServer({
        root,
        configFile: false,
        logLevel: 'silent',
        server: { port: 0, host: '127.0.0.1' },
        plugins: [vitePlugin({ build: { cache: false }, production: { mangle: false } })],
        resolve: {
            alias: {
                '@csszyx/runtime': resolve(import.meta.dirname, '../../runtime/src/index.ts'),
                '@': join(root, 'src'),
            },
        },
    });
    servers.push(server);
    await server.listen();
    // Each reload, with what the theme groups said when it was sent.
    const reloads: string[] = [];
    const send = server.ws.send.bind(server.ws) as (payload: unknown) => void;
    server.ws.send = ((payload: { type?: string }) => {
        if (payload?.type === 'full-reload') reloads.push('full-reload');
        send(payload);
    }) as typeof server.ws.send;

    await server.transformRequest('/src/main.ts');
    expect(await readGeneratedModule(server)).toContain('"brand"');
    expect(await readGeneratedModule(server)).not.toContain('"accent"');
    return { root, stylesheet, server, reloads };
}

describe('adding an aliased @import on a running Vite dev server', () => {
    it('reads the theme it reaches without a restart, and reloads the page for it', async () => {
        const { stylesheet, server, reloads } = await serveAliasProject(BRAND, true);

        writeFileSync(stylesheet, `${BRAND}@import "@/gen/tokens.css";\n`);

        await expect
            .poll(() => readGeneratedModule(server), { timeout: 20_000, interval: 250 })
            .toContain('"accent"');
        expect(await readGeneratedModule(server)).toContain('"brand"');
        // The page booted with a registration that has no `accent`; only a
        // reload runs the new one, and the edit that brought it sends it.
        await expect
            .poll(() => reloads.length, { timeout: 20_000, interval: 250 })
            .toBeGreaterThan(0);
    }, 60_000);
});

describe('creating the stylesheet an aliased @import could not find', () => {
    it('follows it once the watcher reports it, without a restart', async () => {
        // A bare target Vite's full resolve answers against the importing
        // folder: missing at start, it is a miss Vite's resolver keeps.
        const { root, server, reloads } = await serveAliasProject(
            `${BRAND}@import "gen/tokens.css";\n`,
            false,
        );

        writeFileSync(join(root, 'src/gen/tokens.css'), TOKENS);

        await expect
            .poll(() => readGeneratedModule(server), { timeout: 20_000, interval: 250 })
            .toContain('"accent"');
        await expect
            .poll(() => reloads.length, { timeout: 20_000, interval: 250 })
            .toBeGreaterThan(0);
    }, 60_000);
});
