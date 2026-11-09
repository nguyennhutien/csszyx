/**
 * A build names each `_` an `sz` value carries that the project's Tailwind
 * reads as a space, at the key that writes it.
 *
 * The engine reports the fact; the build asks the design system it already
 * compiled for the merge table (PROJECT-RULES §4). `url()` keeps its `_`
 * because this Tailwind says so, and a space the author wrote is csszyx's own
 * `_`: neither is named.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import webpack from 'webpack';

import { vitePlugin, webpackPlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

const LINE =
    "export const A = () => <div sz={{ p: 4, content: \"'a_b'\", gridCols: '1fr 2fr', bgImg: 'url(/a_b.png)' }} />;";

/** Where `content` is written. */
const CONTENT_AT = `src/A.tsx:1:${LINE.indexOf('content') + 1}`;

/**
 * @param config - `csszyx.config.mjs`, when the case sets levels.
 * @returns The project root.
 */
function project(config?: string): string {
    return tailwindProject('csszyx-underscore-', {
        'src/index.css': '@import "tailwindcss";\n',
        'src/A.tsx': `${LINE}\n`,
        ...(config === undefined ? {} : { 'csszyx.config.mjs': config }),
    });
}

/**
 * @returns The `underscore-space` lines the console receives, live.
 */
function underscoreLines(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        const line = args.map(String).join(' ');
        if (line.startsWith('[csszyx] underscore-space:')) lines.push(line);
    });
    return lines;
}

/**
 * Run a Vite build's hooks up to the moment the merge table is settled.
 *
 * @param root - The project root.
 * @returns The hook caller, for a later edit.
 */
async function viteBuild(root: string) {
    const call = callHooks(
        vitePlugin({ build: { cache: false }, production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[],
    );
    await call('configResolved', { root, command: 'build' });
    await call('renderStart');
    return call;
}

describe('a Vite build', () => {
    it('names the `_` Tailwind reads as a space, at its key, with what to write', async () => {
        const lines = underscoreLines();
        await viteBuild(project());
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`[csszyx] underscore-space: ${CONTENT_AT}`);
        expect(lines[0]).toContain(`\`content: "'a b'"\``);
        expect(lines[0]).toContain(`\`content: "'a\\\\_b'"\``);
    }, 60_000);

    it('says nothing when the config turns it off', async () => {
        const lines = underscoreLines();
        await viteBuild(
            project('export default { diagnostics: { rules: { "underscore-space": "off" } } };\n'),
        );
        expect(lines).toEqual([]);
    }, 60_000);

    it('forgets a site an edit removed, and says it again when it comes back', async () => {
        const root = project();
        const lines = underscoreLines();
        const call = await viteBuild(root);
        const file = join(root, 'src/A.tsx');
        await call(
            'transform',
            'export const A = () => <div sz={{ content: "\'a b\'" }} />;\n',
            file,
        );
        await call('renderStart');
        expect(lines).toHaveLength(1);
        await call('transform', `${LINE}\n`, file);
        await call('renderStart');
        expect(lines).toHaveLength(2);
    }, 60_000);
});

describe('a Vite build that reads its transform cache', () => {
    it('names the `_` again on a build whose transform came from the disk cache', async () => {
        const root = project();
        const lines = underscoreLines();
        for (let run = 0; run < 2; run++) {
            const call = callHooks(
                vitePlugin({
                    build: { cache: true },
                    production: { mangle: false },
                }) as unknown as Record<string, unknown>[],
            );
            await call('configResolved', { root, command: 'build' });
            await call('renderStart');
        }
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain(CONTENT_AT);
    }, 60_000);
});

describe('a webpack build', () => {
    it('names the `_` the prescan collected', async () => {
        const root = project();
        writeFileSync(join(root, 'src/index.js'), 'export const ready = true;\n');
        const lines = underscoreLines();
        const compiler = webpack({
            mode: 'production',
            devtool: false,
            context: root,
            entry: './src/index.js',
            output: { path: join(root, 'dist'), filename: 'bundle.js' },
            optimization: { minimize: false },
            plugins: [webpackPlugin({ build: { cache: false }, production: { mangle: false } })],
        });
        await new Promise<void>((resolve, reject) => {
            compiler.run((error, stats) => {
                compiler.close(() => {
                    if (error) reject(error);
                    else if (stats?.hasErrors()) reject(new Error(stats.toString('errors-only')));
                    else resolve();
                });
            });
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(CONTENT_AT);
    }, 120_000);
});
