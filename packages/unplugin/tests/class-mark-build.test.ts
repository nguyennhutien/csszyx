/**
 * A build that mangles marks each class string the compiler emits and renames
 * only those in the chunk (ADR 0034): the marked string comes out renamed with
 * no call left, a data string in the same chunk keeps its name, and a mark the
 * pass cannot read is left to the runtime and reported once the build ends.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { freshFixtureRoot } from './fixture-root.js';

type Call = (hookName: string, ...args: unknown[]) => Promise<unknown>;

interface Build {
    call: Call;
    root: string;
}

/**
 * A plugin instance driven hook by hand over a one-file project.
 *
 * @param mangle - Whether the build mangles classes.
 * @param source - The one file's text.
 * @returns The hook runner and the project root, after the prescan and the map freeze.
 */
async function buildOf(
    mangle: boolean,
    source = 'export const A = () => <div sz={{ p: 4, mx: 2 }} />;',
): Promise<Build> {
    const root = freshFixtureRoot('class-mark-build');
    mkdirSync(resolve(root, 'src'), { recursive: true });
    writeFileSync(resolve(root, 'src/A.tsx'), source, 'utf8');
    const plugins = vitePlugin({
        build: { cache: false },
        production: { mangle },
    }) as unknown as Record<string, unknown>[];
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    const call: Call = async (hookName, ...args) => {
        const plugin = plugins.find(p => p && hookName in p);
        const hook = plugin?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
    await call('configResolved', { root, command: 'build' });
    return { call, root };
}

describe('a mangle build over marked class strings', () => {
    it('renames the marked string, leaves no call, and keeps a data string', async () => {
        const { call, root } = await buildOf(true);
        const transformed = (await call(
            'transform',
            'export const A = () => <div sz={{ p: 4, mx: 2 }} />;',
            resolve(root, 'src/A.tsx'),
        )) as { code: string };
        expect(transformed.code).toContain('/*#__PURE__*/__szCss("p-4 mx-2")');
        await call('buildEnd');
        await call('renderStart');

        const chunk = `${transformed.code}\nel.style.setProperty("margin", "p-4");`;
        const rendered = (await call('renderChunk', chunk)) as { code: string } | null;
        const code = rendered?.code ?? chunk;
        expect(code).not.toContain('__szCss(');
        expect(code).not.toMatch(/className: *"p-4 mx-2"/);
        expect(code).toContain('el.style.setProperty("margin", "p-4");');
    });

    it('reports a mark it could not read once the build ends', async () => {
        const { call } = await buildOf(true);
        await call('buildEnd');
        await call('renderStart');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            await call('renderChunk', 'x(/*#__PURE__*/__szCss(cls), /*#__PURE__*/__szCss(a + b));');
            await call('closeBundle');
            const lines = warn.mock.calls.map(args => String(args[0]));
            expect(lines.filter(line => line.includes('mangle-mark-missed'))).toHaveLength(1);
            expect(lines.join('\n')).toContain('could not read 2 class string(s)');
        } finally {
            warn.mockRestore();
        }
    });

    it('inlines a mark with its names as written when the map is empty', async () => {
        // No module owns a class, so the map is empty; the call still must not
        // reach the browser.
        const { call } = await buildOf(true, 'export const A = () => <div className="card" />;');
        await call('buildEnd');
        await call('renderStart');
        const rendered = (await call('renderChunk', 'x(/*#__PURE__*/__szCss("p-4 mx-2"));')) as {
            code: string;
        } | null;
        expect(rendered?.code).toBe('x("p-4 mx-2");');
    });

    it('leaves a build that does not mangle as the bundler rendered it', async () => {
        const { call } = await buildOf(false);
        await call('buildEnd');
        await call('renderStart');
        const chunk = 'x(/*#__PURE__*/__szCss("p-4"));';
        expect(await call('renderChunk', chunk)).toBeNull();
    });
});
