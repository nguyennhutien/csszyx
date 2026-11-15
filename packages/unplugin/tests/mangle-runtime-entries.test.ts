/**
 * Every runtime entry whose helpers name a class at runtime reads the mangle
 * registry, so a module that imports one must have the registry installed.
 * The build installs it in each module that imports the runtime; this checks
 * the subpath entries, not only the package's main entry, through a real
 * Vite server build that resolves each through the package's own `exports`.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';

const roots: string[] = [];

afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The state a runtime copy leaves on the global object; each build loads its own copy. */
const RUNTIME_GLOBALS = [
    '__csszyx_mangle_registry',
    '__csszyx_lowering',
    '__csszyx_class_prefix',
    '__csszyx_class_prefix_registration',
    '__csszyx_ssr_mangle_map',
    '__csszyx',
] as const;

/** Drop every global a previous case's runtime left, so no case reads another's. */
function clearRuntimeGlobals(): void {
    const global = globalThis as Record<string, unknown>;
    for (const name of RUNTIME_GLOBALS) delete global[name];
}

/**
 * A module that lowers `{ p: 4 }` at runtime through one entry's helper, once
 * when it loads and once when called. The object is read at runtime, so the
 * compiler cannot lower the call itself. The module is imported ahead of the
 * one that owns `p-4`, so at load only its own imports can have installed the
 * registry.
 */
const CONSUMERS: Record<string, string> = {
    main: [
        "import { szr } from '@csszyx/runtime';",
        'const o = () => JSON.parse(\'{"p":4}\');',
        'export const early = szr(o());',
        'export const run = () => szr(o());',
    ].join('\n'),
    // `/core` lowers an object only once the lowering entry is loaded, as an
    // app that calls `szr` with one imports it.
    core: [
        "import '@csszyx/runtime/lowering';",
        "import { szr } from '@csszyx/runtime/core';",
        'const o = () => JSON.parse(\'{"p":4}\');',
        'export const early = szr(o());',
        'export const run = () => szr(o());',
    ].join('\n'),
    // A helper that reads the registry without lowering anything, so nothing
    // else brings in the main entry: `pick` decodes a token before it
    // classifies it. The build gives the one owned class the first token,
    // `z`; read through the registry it is `p-4`, a padding class, and kept.
    split: [
        "import { pick } from '@csszyx/runtime/split';",
        "export const early = pick('z', 'padding');",
        "export const run = token => pick(token, 'padding');",
    ].join('\n'),
};

/**
 * Build a server bundle of one consumer beside a module that owns `p-4`, and
 * run it.
 *
 * @param consumer - The consumer module's source.
 * @returns The owner's class, and what the consumer lowered `{ p: 4 }` to
 *          when it loaded and when called.
 */
async function lowered(
    consumer: string,
): Promise<{ owner: string; early: string; consumer: string }> {
    const root = mkdtempSync(join(import.meta.dirname, '..', '.tmp-mangle-entries-'));
    roots.push(root);
    const files: Record<string, string> = {
        'src/Owner.tsx': 'export const Owner = () => <div sz={{ p: 4 }} />;\n',
        'src/consumer.ts': consumer,
        'src/main.ts': [
            "import { early, run } from './consumer.ts';",
            "import { Owner } from './Owner.tsx';",
            'export const read = () => {',
            '    const owner = Owner().p.className;',
            '    return { owner, early, consumer: run(owner) };',
            '};',
        ].join('\n'),
    };
    for (const [file, source] of Object.entries(files)) {
        mkdirSync(join(root, dirname(file)), { recursive: true });
        writeFileSync(join(root, file), source, 'utf8');
    }
    await build({
        root,
        logLevel: 'silent',
        plugins: [
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
            jsxFragment: 'Fragment',
            jsxInject: 'const h = (t, p, ...c) => ({ t, p, c }); const Fragment = "f";',
        },
        ssr: { noExternal: true },
        build: { ssr: 'src/main.ts', outDir: 'dist', minify: false },
    });
    const out = join(root, 'dist');
    const entry = readdirSync(out).find(file => /\.m?js$/.test(file));
    if (entry === undefined) throw new Error(`no server bundle in ${out}`);
    clearRuntimeGlobals();
    try {
        const { read } = (await import(pathToFileURL(join(out, entry)).href)) as {
            read: () => { owner: string; early: string; consumer: string };
        };
        return read();
    } finally {
        clearRuntimeGlobals();
    }
}

describe('the mangle registry through each runtime entry', () => {
    it.each(Object.keys(CONSUMERS))(
        'names a class lowered through %s as the build renamed it',
        async name => {
            const { owner, early, consumer } = await lowered(CONSUMERS[name] as string);
            expect(owner, 'the build renamed the owned class').not.toBe('p-4');
            expect(consumer).toBe(owner);
            expect(early, 'read while the module loaded').toBe(owner);
        },
        120_000,
    );
});
