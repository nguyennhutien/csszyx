/**
 * The Vite plugin renders only the diagnostics it prints, and keeps none of
 * their text in its transform cache.
 *
 * Its transform leaves each engine diagnostic unrendered; the router renders
 * the ones the policy and the limiter list, with the suggestion an unknown key
 * gets. A cache entry holds the issues and the path their headers name, and a
 * build reading it back prints the same line.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const servers: ViteDevServer[] = [];
const roots: string[] = [];

afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const SOURCE = "export const A = () => <div sz={{ workBreak: 'all', p: 4 }} />;\n";

/**
 * Transform `src/A.tsx` through a fresh dev server on one project root.
 *
 * @param root - The project root, reused to read the cache a first run wrote.
 * @returns Every `console.warn` line that names a csszyx code.
 */
async function warnings(root: string): Promise<string[]> {
    const lines: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    });
    const server = await createServer({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [vitePlugin({}) as never],
    });
    servers.push(server);
    try {
        await server.transformRequest('/src/A.tsx');
    } catch {
        /* the transform ran; only resolving the runtime import failed */
    }
    warn.mockRestore();
    return lines.filter(line => line.includes('[csszyx] unknown-key:'));
}

/**
 * Every transform cache entry under a root.
 *
 * @param root - The project root.
 * @returns The parsed entries.
 */
function cacheEntries(root: string): Array<{ result: Record<string, unknown> }> {
    const dir = join(root, '.csszyx/cache/transform');
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => JSON.parse(readFileSync(join(entry.parentPath, entry.name), 'utf8')));
}

describe('the plugin lane', () => {
    it('prints an unknown key with its suggestion, and caches no message text', async () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-unrendered-lane-'));
        roots.push(root);
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/A.tsx'), SOURCE);

        const first = await warnings(root);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatch(/^\[csszyx\] unknown-key: src\/A\.tsx:1:\d+\n/);
        expect(first[0]).toContain('help: write `break` if you meant it;');

        const [entry] = cacheEntries(root);
        expect(entry?.result.diagnostics).toEqual([]);
        expect(entry?.result.diagnosticFile).toBe('src/A.tsx');

        // A second server reads the entry back and prints the same line.
        expect(await warnings(root)).toEqual(first);
    });
});
