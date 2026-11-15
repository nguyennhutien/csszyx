/**
 * The marks are inlined before any other plugin renders the chunk. A minifier
 * plugin that runs its `renderChunk` first drops each `/*#__PURE__*\/`
 * annotation and may rename the helper, and then the pass can neither inline
 * a mark nor count it as missed: every class went to the runtime, and the
 * build said nothing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { build, type Plugin } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const roots: string[] = [];

afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the class-mark pass beside another renderChunk', () => {
    it('reads each chunk before a plugin listed ahead of csszyx', async () => {
        const root = mkdtempSync(join(import.meta.dirname, '..', '.tmp-mark-order-'));
        roots.push(root);
        const file = 'src/A.tsx';
        mkdirSync(join(root, dirname(file)), { recursive: true });
        writeFileSync(join(root, file), 'export const A = () => <div sz={{ p: 4 }} />;\n', 'utf8');
        const seen: string[] = [];
        // Listed without `enforce`, so Vite runs it ahead of csszyx's post plugin.
        const minifier: Plugin = {
            name: 'fixture-minifier',
            renderChunk(code) {
                seen.push(code);
                return { code: code.replaceAll('/*#__PURE__*/', ''), map: null };
            },
        };
        await build({
            root,
            logLevel: 'silent',
            plugins: [
                minifier,
                vitePlugin({
                    build: { cache: false },
                    // The fixture sits under `packages/`, which a build skips unless named.
                    compileSources: ['src'],
                    production: { mangle: true },
                }),
            ],
            esbuild: {
                jsx: 'transform',
                jsxFactory: 'h',
                jsxInject: 'const h = (t, p, ...c) => ({ t, p, c });',
            },
            ssr: { noExternal: true },
            build: { ssr: file, outDir: 'dist', minify: false },
        });
        expect(seen.length).toBeGreaterThan(0);
        const chunks = seen.join('\n');
        // A mark is a call on a string literal; the runtime's own
        // `function __szCss(classes)` is bundled too.
        expect(chunks).not.toMatch(/__szCss(?:\$\d+)*\("/);
        // A mangle build renames only a marked class, so a renamed one shows
        // the mark was there and inlined; a fixture that wrote no mark would
        // leave `p-4` as written.
        const className = /className: "([^"]*)"/.exec(chunks)?.[1];
        expect(className).toBeDefined();
        expect(className).not.toBe('p-4');
    }, 120_000);
});
