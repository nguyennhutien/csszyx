/**
 * Key and value diagnostics reach the log through the plugin, in production.
 *
 * The classifier and the emitter have their own unit nets, but the field
 * defect was the WIRING: a production build of a file with typo'd keys and
 * values printed nothing but the advisory census, because no channel in the
 * plugin's report loop routed the family. A unit test of the emitter cannot
 * notice the call going missing again, so this one drives the plugin itself
 * and reads what the console received.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const servers: ViteDevServer[] = [];

afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    vi.restoreAllMocks();
});

/** One file carrying every kind the family reports: a dead key, a dead value, an owned key holding an object. */
const SOURCE =
    "export const A = () => <div sz={{ zzz: 4, display: 'bogus', '--v-x': { p: 4 } }} />;\n";

/**
 * Transform one module through the plugin under `NODE_ENV=production` and
 * collect every line the console received.
 *
 * @param quiet - The plugin's `quiet` option, when the case is about it.
 * @returns Every `console.warn` line.
 */
async function consoleWarnings(quiet?: 'nudges' | 'all'): Promise<string[]> {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-key-value-diag-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/A.tsx'), SOURCE);
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    });
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        const server = await createServer({
            root,
            configFile: false,
            logLevel: 'silent',
            plugins: [vitePlugin(quiet === undefined ? {} : { quiet }) as never],
        });
        servers.push(server);
        // The import rewrite points at a package this fixture does not
        // install, so resolution throws after the transform under test ran.
        try {
            await server.transformRequest('/src/A.tsx');
        } catch {
            /* the transform ran; only the later resolve failed */
        }
    } finally {
        if (before === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = before;
    }
    return lines;
}

/**
 * How many collected lines carry a marker.
 *
 * @param lines - The console lines.
 * @param marker - Text unique to one diagnostic.
 * @returns The count, so a double print fails as loudly as a missing one.
 */
function count(lines: string[], marker: string): number {
    return lines.filter(line => line.includes(marker)).length;
}

describe('key and value diagnostics through the plugin', () => {
    it('prints each of them exactly once in a production run', async () => {
        const lines = await consoleWarnings();
        expect(count(lines, 'Unknown property "zzz"')).toBe(1);
        expect(count(lines, '"display: bogus"')).toBe(1);
        expect(count(lines, '"--v-x"')).toBe(1);
    }, 60_000);

    it('still prints them under quiet: nudges', async () => {
        const lines = await consoleWarnings('nudges');
        expect(count(lines, '"display: bogus"')).toBe(1);
    }, 60_000);

    it('holds them back only under quiet: all', async () => {
        const lines = await consoleWarnings('all');
        expect(count(lines, 'Unknown property "zzz"')).toBe(0);
        expect(count(lines, '"display: bogus"')).toBe(0);
        expect(count(lines, '"--v-x"')).toBe(0);
    }, 60_000);
});
