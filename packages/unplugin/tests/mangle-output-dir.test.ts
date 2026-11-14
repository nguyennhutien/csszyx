/**
 * A build does not read its own output as a source. The walk skips folders
 * named `dist` or `build` and what `.gitignore` covers; an `outDir` named
 * otherwise, with no `.gitignore`, was read on the next build, and the
 * previous bundle's unmarked class strings left every owned class out of the
 * map, so the second build renamed nothing.
 */
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const requireFromHere = createRequire(import.meta.url);
const roots: string[] = [];

afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Build the fixture into `out` and read the class its element got.
 *
 * @param root - The fixture root.
 * @param out - The output folder, relative to the root.
 * @param run - Which build this is, so each loads its own bundle.
 * @returns The element's class.
 */
async function classOf(root: string, out: string, run: number): Promise<string> {
    await build({
        root,
        logLevel: 'silent',
        // A root outside the workspace resolves the runtime from here.
        resolve: {
            alias: [
                {
                    find: /^@csszyx\/runtime$/,
                    replacement: requireFromHere.resolve('@csszyx/runtime'),
                },
            ],
        },
        plugins: [
            // No `compileSources`: the whole root is walked, as in an app.
            vitePlugin({ build: { cache: false }, production: { mangle: true } }),
        ],
        esbuild: {
            jsx: 'transform',
            jsxFactory: 'h',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c });',
        },
        ssr: { noExternal: true },
        build: { ssr: 'src/A.tsx', outDir: out, minify: false, emptyOutDir: true },
    });
    const entry = readdirSync(join(root, out)).find(file => /\.m?js$/.test(file));
    if (entry === undefined) throw new Error(`no server bundle in ${out}`);
    const url = `${pathToFileURL(join(root, out, entry)).href}?run=${run}`;
    const { A } = (await import(url)) as { A: () => { p: { className: string } } };
    return A().p.className;
}

describe('the output folder of a mangle build', () => {
    it('is not read as a source by the next build', async () => {
        const root = mkdtempSync(join(realpathSync(tmpdir()), 'csszyx-mangle-outdir-'));
        roots.push(root);
        const file = join(root, 'src/A.tsx');
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, 'export const A = () => <div sz={{ p: 4 }} />;\n', 'utf8');

        const first = await classOf(root, 'dist-on', 1);
        const second = await classOf(root, 'dist-on', 2);
        expect(first, 'the first build renamed the class').not.toBe('p-4');
        expect(second).toBe(first);
    }, 120_000);
});
