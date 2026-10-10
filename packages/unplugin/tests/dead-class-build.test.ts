/**
 * A build names every `sz` class the project's Tailwind serves no CSS for.
 *
 * `{ break: 'bogus' }` lowers to `break-bogus` and `{ justify: 'safe-center' }`
 * to `justify-safe-center`: both keys are real, so no key diagnostic fires,
 * and the class sits in the DOM styling nothing. Only `csszyx check` used to
 * say so. The build already compiles the project's design system to settle
 * the merge table, so it asks the same question of the classes `sz` emitted —
 * never of the `className` vocabulary, whose unserved names are an app's own
 * classes, not mistakes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import webpack from 'webpack';

import { deadClassMessage } from '../src/dead-class.js';
import { vitePlugin, webpackPlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/** Where `{ break: 'bogus' }` is written: the key the class was lowered from. */
const BREAK_SITE = {
    line: 1,
    column: 'export const A = () => <div sz={{ '.length + 1,
    key: 'break',
};

// `p` covers `px`, so the build merges this object and lowers the file a
// second time; the key positions come from the first pass.
const SOURCE = [
    "export const A = () => <div sz={{ break: 'bogus', px: 2, p: 4 }} />;",
    'export const B = () => <div className="my-own-class" sz={{ justify: \'safe-center\' }} />;',
    '',
].join('\n');

/**
 * A project whose one component emits two dead classes and a served one.
 *
 * @param config - `csszyx.config.mjs`, when the case sets levels.
 * @returns The project root.
 */
function project(config?: string): string {
    return tailwindProject('csszyx-dead-class-', {
        'src/index.css': '@import "tailwindcss";\n',
        'src/A.tsx': SOURCE,
        ...(config === undefined ? {} : { 'csszyx.config.mjs': config }),
    });
}

/**
 * Collect the dead-class lines the console receives.
 *
 * @returns The live list.
 */
function deadLines(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        const line = args.map(String).join(' ');
        if (line.includes('(dead-class)')) lines.push(line);
    });
    return lines;
}

/**
 * Run a Vite build's hooks up to the moment the merge table is settled.
 *
 * @param root - The project root.
 */
async function viteBuild(root: string): Promise<void> {
    const call = callHooks(
        vitePlugin({ build: { cache: false }, production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[],
    );
    await call('configResolved', { root, command: 'build' });
    await call('renderStart');
}

describe('a Vite build', () => {
    it('names each sz class that produces no CSS, with the file, line and key that emit it', async () => {
        const lines = deadLines();
        await viteBuild(project());
        // `justify-safe-center` is the only class of its object, and the
        // engine records a key position only for an object a merge reads.
        expect(lines).toEqual([
            deadClassMessage('break-bogus', 'src/A.tsx', BREAK_SITE),
            deadClassMessage('justify-safe-center', 'src/A.tsx'),
        ]);
        expect(deadClassMessage('break-bogus', 'src/A.tsx')).toBe(
            "[csszyx] src/A.tsx: `break-bogus` is emitted by an sz prop and produces no CSS under this project's Tailwind (dead-class).\n" +
                "  help: fix the sz key or value, or define the class with Tailwind's @utility; `csszyx check --rule dead-class` lists every one.",
        );
    }, 60_000);

    it('says nothing when the config sets dead-class to off', async () => {
        const lines = deadLines();
        await viteBuild(
            project('export default { diagnostics: { rules: { "dead-class": "off" } } };\n'),
        );
        expect(lines).toEqual([]);
    }, 60_000);

    it('leaves out a class the config allows', async () => {
        const lines = deadLines();
        await viteBuild(
            project('export default { diagnostics: { allow: { classes: ["break-bogus"] } } };\n'),
        );
        expect(lines).toEqual([deadClassMessage('justify-safe-center', 'src/A.tsx')]);
    }, 60_000);

    it('applies an override to the file the class comes from', async () => {
        const lines = deadLines();
        await viteBuild(
            project(
                'export default { diagnostics: { overrides: [{ files: "src/**", rules: { "dead-class": "off" } }] } };\n',
            ),
        );
        expect(lines).toEqual([]);
    }, 60_000);

    it('says nothing for a project whose sz classes are all served', async () => {
        const root = project();
        writeFileSync(join(root, 'src/A.tsx'), 'export const A = () => <div sz={{ p: 4 }} />;\n');
        const lines = deadLines();
        await viteBuild(root);
        expect(lines).toEqual([]);
    }, 60_000);

    it('says it once however often the table is settled', async () => {
        const root = project();
        const lines = deadLines();
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        await call('renderStart');
        await call('renderStart');
        expect(lines).toHaveLength(2);
    }, 60_000);

    it('says it again in a watch build once an undo brings back a class an edit removed', async () => {
        const root = project();
        const lines = deadLines();
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );
        const file = join(root, 'src/A.tsx');
        await call('configResolved', { root, command: 'build' });
        await call('renderStart');
        await call('transform', 'export const A = () => <div sz={{ p: 4 }} />;\n', file);
        await call('renderStart');
        expect(lines).toHaveLength(2);
        await call('transform', SOURCE, file);
        await call('renderStart');
        expect(lines).toHaveLength(4);
    }, 60_000);

    it('names a file an override leaves on when another file emitting the class is off', async () => {
        const root = tailwindProject('csszyx-dead-class-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/a-legacy/A.tsx': "export const A = () => <div sz={{ break: 'bogus', p: 4 }} />;\n",
            'src/b/B.tsx': "export const B = () => <div sz={{ break: 'bogus', p: 4 }} />;\n",
            'csszyx.config.mjs':
                'export default { diagnostics: { overrides: [{ files: "src/a-legacy/**", rules: { "dead-class": "off" } }] } };\n',
        });
        const lines = deadLines();
        await viteBuild(root);
        expect(lines).toEqual([
            deadClassMessage('break-bogus', 'src/b/B.tsx', {
                line: 1,
                column: BREAK_SITE.column,
                key: 'break',
            }),
        ]);
    }, 60_000);
});

describe('a webpack build', () => {
    it('names the dead sz classes the prescan collected', async () => {
        const root = project();
        writeFileSync(join(root, 'src/index.js'), 'export const ready = true;\n');
        const lines = deadLines();
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
        expect(readFileSync(join(root, 'dist/bundle.js'), 'utf8')).toContain('ready');
        expect(lines).toEqual([
            deadClassMessage('break-bogus', 'src/A.tsx', BREAK_SITE),
            deadClassMessage('justify-safe-center', 'src/A.tsx'),
        ]);
    }, 120_000);
});
