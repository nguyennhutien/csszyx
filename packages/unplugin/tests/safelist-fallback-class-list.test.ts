/**
 * A module the sz pass does not lower reaches the safelist through the class
 * scanner (`collectAuthoredClassNames`), which reads its quoted `className`
 * strings and expressions. A class holding a BOM (not White_Space, so the engine
 * keeps it inside the class) is safelisted whole, as the runtime and the
 * engine read it, through the real Vite plugin: transform the module in dev,
 * then let an `sz` edit write the safelist the way a dev server does.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const BOM_CLASS = 'content-[a﻿b]';

/**
 * Serve a project, transform one module, then hot-update an `sz` module with
 * a new class so the safelist is written.
 *
 * @param source - The module.
 * @param file - Its name under `src/`.
 * @param onDisk - Whether the module is on disk when the server starts, so
 *        the prescan reads it first.
 * @returns The safelist's class lines.
 */
async function safelistAfter(
    source: string,
    file = 'Plain.tsx',
    onDisk = false,
): Promise<string[]> {
    const { vitePlugin } = await import('../src/unplugin.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-fallback-list-'));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    if (onDisk) fs.writeFileSync(path.join(root, 'src', file), source);
    const plugins = vitePlugin({});
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const call = async (self: object, hookName: string, ...args: unknown[]): Promise<unknown> => {
        const plugin = plugins.find(p => p && hookName in (p as Record<string, unknown>));
        const hook = (plugin as Record<string, unknown> | undefined)?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(self, args) : undefined;
    };
    await call(ctx, 'configResolved', { root, command: 'serve' });
    await call(ctx, 'transform', '@import "tailwindcss";', path.join(root, 'src/index.css'));

    await call(ctx, 'transform', source, path.join(root, 'src', file));

    const card = path.join(root, 'src/Card.tsx');
    fs.writeFileSync(card, 'export const Card = () => <div sz={{ m: 7 }} />;');
    const moduleGraph = { getModulesByFile: () => undefined, getModuleById: () => null };
    const server = {
        config: { root },
        watcher: { emit() {} },
        ws: { send() {} },
        moduleGraph,
        environments: { client: { moduleGraph } },
    };
    const client = { ...ctx, environment: { name: 'client', moduleGraph } };
    await call(client, 'hotUpdate', { type: 'update', file: card, modules: [], server });

    const safelist = fs.readFileSync(path.join(root, '.csszyx/csszyx-classes.txt'), 'utf8');
    return safelist.split('\n').filter(line => line && !line.startsWith('#'));
}

describe('the safelist a module with no sz feeds', () => {
    it.each([
        ['a quoted className', `export const P = () => <div className="${BOM_CLASS} p-4" />;`],
        [
            'a className expression',
            `export const P = ({ on }) => <div className={on ? "${BOM_CLASS} p-4" : "p-2"} />;`,
        ],
    ])('names a class holding a BOM whole, from %s', async (_what, source) => {
        const lines = await safelistAfter(source);
        expect(lines).toContain('m-7');
        expect(lines).toContain(BOM_CLASS);
        expect(lines).toContain('p-4');
        expect(lines).not.toContain('content-[a');
        expect(lines).not.toContain('b]');
    });

    // The names the element carries, not the spelling: a reference decodes,
    // a JavaScript escape is the character it stands for.
    it.each([
        [
            'a character reference',
            'export const P = () => <div className="x&#32;y" />;',
            ['x', 'y'],
            ['x&#32;y'],
        ],
        [
            'an escaped quote in a string',
            String.raw`export const P = () => <div className={"a\"b c"} />;`,
            ['a"b', 'c'],
            ['a\\', 'b'],
        ],
    ])('names what %s reads as', async (_what, source, present, absent) => {
        const lines = await safelistAfter(source);
        for (const name of present) expect(lines).toContain(name);
        for (const name of absent) expect(lines).not.toContain(name);
    });
});

describe('the safelist a template adapter feeds', () => {
    // The adapter writes the classes into its output; the source holds only
    // `sz`, so the classes reach the safelist from that output or not at all.
    it.each([
        [
            'Vue',
            'A.vue',
            `<template><p sz="{ p: 9, hover: { bg: 'blue-700' } }" /></template>\n`,
            ['p-9', 'hover:bg-blue-700'],
        ],
        ['Svelte', 'B.svelte', '<p sz={{ m: 9 }} />\n', ['m-9']],
        // Text is text: its `'` opens no string that hides the class after it.
        [
            'Vue with a quote in its text',
            'C.vue',
            `<template><b>Don't</b><p sz="{ p: 7 }" /></template>\n`,
            ['p-7'],
        ],
    ])('names the classes a %s template lowers to', async (_what, file, source, classes) => {
        const lines = await safelistAfter(source, file);
        for (const name of classes) expect(lines).toContain(name);
    });

    it.each([
        ['Vue', 'D.vue', `<template><p>Don't</p><div class="plain-a">x</div></template>\n`],
        ['Svelte', 'E.svelte', `<p>it's</p>\n<div class="plain-a">x</div>\n`],
    ])(
        'names the classes a %s template without sz writes after a quote in its text',
        async (_what, file, source) => {
            // No `sz`, so no adapter output: the source is read, as markup.
            const lines = await safelistAfter(source, file);
            expect(lines).toContain('plain-a');
        },
    );

    it.each([
        // Keys of a class object, which no markup reading and no scanner gives.
        [
            'Svelte',
            'F.svelte',
            "<script>let on = true;</script>\n<p>it's</p><i class={{ flipped: on }} class:lit={on}>x</i>\n",
            ['flipped', 'lit'],
        ],
        [
            'Vue',
            'G.vue',
            `<template><p>Don't</p><i :class="['v-a', on && 'v-b']" class="v-c">x</i></template>\n`,
            ['v-a', 'v-b', 'v-c'],
        ],
    ])(
        'reads a %s template the prescan walked as its framework does',
        async (_what, file, source, classes) => {
            const lines = await safelistAfter(source, file, true);
            for (const name of classes) expect(lines).toContain(name);
        },
    );
});
