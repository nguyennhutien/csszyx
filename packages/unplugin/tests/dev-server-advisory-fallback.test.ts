/**
 * Advisory sz fallbacks in a dev server.
 *
 * An advisory fallback says the runtime path was taken where a compiled one
 * was possible. A production build holds the list back and prints a count at
 * the end instead; a dev server has no end, so if it holds the list back the
 * reader is told nothing at all. The production signal was read from
 * `NODE_ENV`, which a monorepo script may well set while running `vite dev`,
 * and that combination reported neither the fallbacks nor the count.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const servers: ViteDevServer[] = [];

afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
});

/**
 * Transform one module through a dev server and collect what it logged.
 *
 * @param quiet - The plugin's `quiet` option, when the case is about it.
 * @returns Every warning the server's logger received.
 */
async function warningsFromDevServer(quiet?: 'nudges' | 'all'): Promise<string[]> {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-dev-advisory-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/App.tsx'), 'export const App = ({ box }) => <div sz={box} />;\n');
    const warnings: string[] = [];
    const record = (message: string): void => {
        warnings.push(message);
    };
    const server = await createServer({
        root,
        configFile: false,
        customLogger: {
            info() {},
            warn: record,
            warnOnce: record,
            error: record,
            clearScreen() {},
            hasErrorLogged: () => false,
            hasWarned: false,
        } as never,
        plugins: [vitePlugin(quiet === undefined ? {} : { quiet }) as never],
    });
    servers.push(server);
    // The import rewrite points at a package this fixture does not install, so
    // resolution throws after the transform this test is about has run.
    try {
        await server.transformRequest('/src/App.tsx');
    } catch {
        /* the transform ran; only the later resolve failed */
    }
    return warnings;
}

describe('advisory fallbacks in a dev server', () => {
    it('lists a fallback even when NODE_ENV says production', async () => {
        const before = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const warnings = await warningsFromDevServer();
            expect(warnings.join('\n')).toContain('sz fallback');
        } finally {
            if (before === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = before;
        }
    }, 60_000);

    it('lists a fallback in an ordinary dev server', async () => {
        const warnings = await warningsFromDevServer();
        expect(warnings.join('\n')).toContain('sz fallback');
    }, 60_000);

    // Asking for a calmer log is a decision about this list, and it holds in a
    // dev server exactly as it does in a build.
    it('holds the list back when a quiet mode asked for it', async () => {
        const warnings = await warningsFromDevServer('nudges');
        expect(warnings.join('\n')).not.toContain('sz fallback');
    }, 60_000);
});
