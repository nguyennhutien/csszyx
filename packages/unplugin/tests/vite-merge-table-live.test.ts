/** Source edits must replace the registration cached by a real Vite server. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import {
    linkTailwindIntegration,
    removeTailwindProjects,
    tailwindProject,
} from './tailwind-project.js';

const servers: ViteDevServer[] = [];

afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    vi.restoreAllMocks();
    removeTailwindProjects();
});

/**
 * Make both runtime entry points consume the same authored candidates.
 *
 * @param tokens - Classes passed to each helper.
 * @returns Executable application source.
 */
function source(tokens: string[]): string {
    const args = tokens.map(token => JSON.stringify(token)).join(',');
    return `import { szcn, _szcn } from '@csszyx/runtime';
export const result = [szcn(${args}), _szcn(${args})];`;
}

describe('source edits on a running Vite server', () => {
    it.each(['', ' source(none)'])(
        'replaces the cached merge registration with Tailwind%s',
        async detection => {
            const root = tailwindProject('csszyx-merge-live-', {
                'app.css': `@import "tailwindcss"${detection};`,
                'src/value.js': source(['p-4']),
            });
            linkTailwindIntegration(root);
            vi.spyOn(process, 'cwd').mockReturnValue(root);
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const file = join(root, 'src/value.js');
            let completedEdits = 0;
            const server = await createServer({
                root,
                configFile: false,
                logLevel: 'silent',
                server: { port: 0, host: '127.0.0.1' },
                plugins: [
                    vitePlugin({ build: { cache: false }, production: { mangle: false } }),
                    {
                        name: 'observe-merge-update-completion',
                        hotUpdate: {
                            order: 'post',
                            handler(ctx) {
                                if (this.environment.name === 'client' && ctx.file === file) {
                                    completedEdits += 1;
                                }
                            },
                        },
                    },
                ],
            });
            servers.push(server);
            await server.listen();
            expect((await server.ssrLoadModule('/src/value.js')).result).toEqual(['p-4', 'p-4']);
            let registration = await server.ssrLoadModule('virtual:csszyx/unserved');

            // Each edit is observed AFTER csszyx's awaited client hook. No
            // hand-made invalidation, time-based sleep or cache-busting URL.
            for (const tokens of [
                ['p-4', 'p-2'],
                ['p-2', 'p-1'],
            ]) {
                const previousEdits = completedEdits;
                writeFileSync(file, source(tokens));
                await expect
                    .poll(() => completedEdits, { timeout: 10_000 })
                    .toBeGreaterThan(previousEdits);
                expect((await server.ssrLoadModule('/src/value.js')).result).toEqual([
                    tokens[1],
                    tokens[1],
                ]);
                const next = await server.ssrLoadModule('virtual:csszyx/unserved');
                expect(next).not.toBe(registration);
                registration = next;
            }

            // Changing JavaScript without adding candidates keeps the exact
            // registration module, even though the source itself re-runs.
            const previousEdits = completedEdits;
            writeFileSync(file, `${source(['p-2', 'p-1'])}\nexport const edited = true;`);
            await expect
                .poll(() => completedEdits, { timeout: 10_000 })
                .toBeGreaterThan(previousEdits);
            expect((await server.ssrLoadModule('/src/value.js')).edited).toBe(true);
            expect(await server.ssrLoadModule('virtual:csszyx/unserved')).toBe(registration);
        },
        60_000,
    );
});
