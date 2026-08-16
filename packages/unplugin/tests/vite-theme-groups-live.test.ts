/**
 * The theme-group registration against a REAL Vite dev server.
 *
 * The other HMR tests here call `handleHotUpdate` with a hand-made module
 * graph, which proves the hook was written but not that a running server ever
 * reaches it. This boots an actual dev server, edits a stylesheet on disk, and
 * asks the server for the generated module again — so the watcher, the
 * project-wide rescan, the module-graph invalidation and the regenerated
 * payload are all exercised as one path.
 *
 * What it deliberately does NOT cover is the browser re-executing that module;
 * that needs a real page and lives in the Playwright suite. This is the half
 * csszyx owns.
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

const BOTH_TOKENS = `@import 'tailwindcss';
@theme {
    --color-brand: oklch(0.7 0.1 250);
    --color-accent: oklch(0.6 0.2 25);
}
`;

const ACCENT_REMOVED = `@import 'tailwindcss';
@theme {
    --color-brand: oklch(0.7 0.1 250);
}
`;

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

describe('editing @theme on a running Vite dev server', () => {
    it('regenerates the registration without a restart', async () => {
        loadNativeBinding();
        // realpath: on macOS `tmpdir()` is a symlink (`/var` → `/private/var`)
        // and Vite resolves its root through it, so an un-resolved root makes
        // every module request miss.
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-vite-live-')));
        roots.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        const stylesheet = join(root, 'src/theme.css');
        writeFileSync(stylesheet, BOTH_TOKENS, 'utf8');
        writeFileSync(
            join(root, 'src/main.ts'),
            "import { szcn } from '@csszyx/runtime';\nexport const merged = szcn('text-brand', 'text-accent');\n",
            'utf8',
        );

        const server = await createServer({
            root,
            logLevel: 'silent',
            server: { port: 0, host: '127.0.0.1' },
            plugins: [vitePlugin({ build: { cache: false }, production: { mangle: false } })],
            resolve: {
                alias: {
                    '@csszyx/runtime': resolve(import.meta.dirname, '../../runtime/src/index.ts'),
                },
            },
        });
        servers.push(server);
        await server.listen();

        // Pull the app module first: that is what makes the plugin inject the
        // registration import, the same order a page load produces.
        await server.transformRequest('/src/main.ts');
        expect(await readGeneratedModule(server)).toContain('"accent"');

        // The ONLY change is on disk. Nothing else is invalidated by hand.
        writeFileSync(stylesheet, ACCENT_REMOVED, 'utf8');

        await expect
            .poll(() => readGeneratedModule(server), { timeout: 20_000, interval: 250 })
            .not.toContain('"accent"');

        // Still a complete declaration, not an empty one — the surviving token
        // has to stay registered or the merge would regress the other way.
        expect(await readGeneratedModule(server)).toContain('"brand"');
        // And it replaces rather than adds, which is what lets a token leave.
        expect(await readGeneratedModule(server)).toContain('setSzcnGroups');
    }, 60_000);
});
