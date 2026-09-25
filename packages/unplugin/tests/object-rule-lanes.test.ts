/**
 * Every lane with a stylesheet merges a later sz key over an earlier one it covers.
 *
 * The engine applies the table and does not build it. Each lane that opens the
 * project's style model before it lowers anything hands the engine the pairs
 * among one file's classes that cover each other, read from the compiled CSS,
 * so `{ pb: 2, p: 4 }` compiles to `p-4` on Vite, Rollup, esbuild and webpack
 * alike — including the lanes that ship no merge table to the runtime.
 *
 * The rendered difference is real: Tailwind writes the shorthand's rule first,
 * so a build that keeps both classes gives the bottom edge `pb-2`'s 0.5rem.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SAFELIST_FILE } from '../src/safelist-source.js';
import { esbuildPlugin, rollupPlugin, vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const APP = [
    'export const Covered = () => <div sz={{ pb: 2, p: 4 }} />;',
    'export const Refined = () => <div sz={{ p: 4, pb: 2 }} />;',
    '',
].join('\n');
const OPTIONS = { build: { cache: false }, production: { mangle: false } };

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * A project with the component and a stock Tailwind entry.
 *
 * @returns Absolute project root.
 */
function project(): string {
    return tailwindProject('csszyx-object-rule-', {
        'src/theme.css': '@import "tailwindcss";\n',
        'src/App.tsx': APP,
        'src/index.js': 'export const ready = true;\n',
    });
}

/**
 * The class lists the emitted code carries, in order.
 *
 * @param code - Emitted module code.
 * @returns Each `className` string literal.
 */
function classNames(code: string): string[] {
    return [...code.matchAll(/className[=:]\s*"([^"]*)"/g)].map(match => match[1] as string);
}

describe('the object rule on each lane', () => {
    it('vite keeps only the covering key, and a later refinement', async () => {
        const root = project();
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', APP, join(root, 'src/App.tsx'))) as {
            code: string;
        };

        expect(classNames(result.code)).toEqual(['p-4', 'p-4 pb-2']);
    }, 60_000);

    // The way back when a project's stylesheet is read wrong: the build then
    // does what it did before the rule, and the stylesheet decides.
    it('vite keeps every key when `build.mergeCoveredClasses` is off', async () => {
        const root = project();
        const call = callHooks(
            vitePlugin({
                ...OPTIONS,
                build: { ...OPTIONS.build, mergeCoveredClasses: false },
            }) as unknown as Record<string, unknown>[],
        );

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', APP, join(root, 'src/App.tsx'))) as {
            code: string;
        };

        expect(classNames(result.code)).toEqual(['pb-2 p-4', 'p-4 pb-2']);
    }, 60_000);

    // The safelist is what Tailwind generates, and a class the build's merge
    // removed can still be emitted by a path that resolves at run time.
    it('vite keeps the dropped class in the safelist it writes', async () => {
        const root = tailwindProject('csszyx-object-rule-safelist-', {
            'src/theme.css': '@import "tailwindcss";\n',
            'src/App.tsx': 'export const A = () => <div sz={{ pt: 2, p: 4 }} />;\n',
            'src/index.js': 'export const ready = true;\n',
        });
        const call = callHooks(vitePlugin(OPTIONS) as unknown as Record<string, unknown>[]);

        await call('configResolved', { root, command: 'build' });
        const safelist = readFileSync(join(root, SAFELIST_FILE), 'utf8').split('\n');

        expect(safelist).toContain('p-4');
        expect(safelist).toContain('pt-2');
    }, 60_000);

    it('rollup merges from the model it opens at build start', async () => {
        const root = project();
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const [pre] = rollupPlugin(OPTIONS) as unknown as Array<{
            buildStart: (this: unknown) => Promise<void>;
            transform: (this: unknown, code: string, id: string) => { code: string };
        }>;
        const ctx = { warn() {}, meta: {} };

        await pre?.buildStart.call(ctx);
        const result = pre?.transform.call(ctx, APP, join(root, 'src/App.tsx'));

        expect(classNames(result?.code ?? '')).toEqual(['p-4', 'p-4 pb-2']);
    }, 60_000);

    it('esbuild merges too, though it ships no table to the runtime', async () => {
        const root = project();
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const output = await build({
            absWorkingDir: root,
            entryPoints: ['src/App.tsx'],
            write: false,
            bundle: false,
            jsx: 'preserve',
            logLevel: 'silent',
            plugins: [esbuildPlugin(OPTIONS)],
        });

        expect(classNames(output.outputFiles[0]?.text ?? '')).toEqual(['p-4', 'p-4 pb-2']);
    }, 60_000);
});
