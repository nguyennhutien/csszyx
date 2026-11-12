/**
 * A server bundle of a module that only writes `sz` (ADR 0034). Such a module
 * imported nothing from csszyx before, so the server bundle installed no mangle
 * registry and a class string it built at runtime kept its original name. A
 * mangle build now imports `__szCss` from `@csszyx/runtime` into each module
 * it marks: the registry installs in that module, every marked string arrives
 * renamed, and no call is left for the server to run.
 */
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const requireFromHere = createRequire(import.meta.url);
const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('a server bundle of an sz-only module', () => {
    it('installs the registry and renders every marked class renamed', async () => {
        const root = mkdtempSync(join(realpathSync(tmpdir()), 'csszyx-mangle-ssr-'));
        tempDirs.push(root);
        const files: Record<string, string> = {
            'src/Card.tsx': [
                'export const Card = ({ on }) => (',
                "    <div sz={{ p: 4, mx: 2 }}><b sz={on ? { bg: 'blue-500' } : { m: 3 }} /></div>",
                ');',
            ].join('\n'),
        };
        for (const [file, source] of Object.entries(files)) {
            mkdirSync(join(root, dirname(file)), { recursive: true });
            writeFileSync(join(root, file), source, 'utf8');
        }
        await build({
            root,
            logLevel: 'silent',
            resolve: {
                alias: [
                    {
                        find: /^@csszyx\/runtime$/,
                        replacement: requireFromHere.resolve('@csszyx/runtime'),
                    },
                ],
            },
            plugins: [vitePlugin({ build: { cache: false }, production: { mangle: true } })],
            esbuild: {
                jsx: 'transform',
                jsxFactory: 'h',
                jsxFragment: 'Fragment',
                jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
            },
            ssr: { noExternal: true },
            build: { ssr: 'src/Card.tsx', outDir: 'dist', minify: false },
        });

        const out = join(root, 'dist');
        const entry = readdirSync(out).find(file => /\.m?js$/.test(file));
        if (entry === undefined) throw new Error(`no server bundle in ${out}`);
        const code = readFileSync(join(out, entry), 'utf8');
        expect(code).not.toMatch(/\/\*#__PURE__\*\/\s*\S*__szCss/);

        const global = globalThis as {
            __csszyx_mangle_registry?: { encode(name: string): string | undefined };
        };
        delete global.__csszyx_mangle_registry;
        try {
            const { Card } = (await import(pathToFileURL(join(out, entry)).href)) as {
                Card: (props: { on: boolean }) => {
                    p: { className: string };
                    c: Array<{ p: { className: string } }>;
                };
            };
            const registry = global.__csszyx_mangle_registry;
            expect(registry, 'the server bundle installed the registry').toBeDefined();
            const encode = (classes: string): string =>
                classes
                    .split(' ')
                    .map(name => registry?.encode(name) ?? name)
                    .join(' ');
            const on = Card({ on: true });
            const off = Card({ on: false });
            expect(on.p.className).toBe(encode('p-4 mx-2'));
            expect(on.p.className).not.toBe('p-4 mx-2');
            expect(on.c[0]?.p.className).toBe(encode('bg-blue-500'));
            expect(on.c[0]?.p.className).not.toBe('bg-blue-500');
            expect(off.c[0]?.p.className).toBe(encode('m-3'));
            expect(off.c[0]?.p.className).not.toBe('m-3');
        } finally {
            delete global.__csszyx_mangle_registry;
        }
    }, 120_000);
});
