/**
 * A webpack watch session notices a Tailwind prefix that changes while it runs.
 *
 * webpack keeps every module it compiled and rebuilds only what changed, so a
 * stylesheet edit that changes the prefix leaves every earlier module holding
 * classes under the old one. A plugin cannot make webpack recompile them all,
 * so the rebuild reports the change as a compile error that says to restart:
 * a green rebuild would ship a page whose classes style nothing.
 *
 * The build read the stylesheets to decide the prefix, so it depends on them:
 * an edit to one triggers a rebuild even when no module imports it.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import webpack from 'webpack';

import { webpackPlugin } from '../src/unplugin.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const APP = 'export const App = () => <div sz={{ p: 4 }} />;\n';
const STOCK = '@import "tailwindcss";\n';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * Watch a stock project through one stylesheet edit.
 *
 * @param css - What `src/index.css` becomes after the first build.
 * @returns The errors of every build, and everything printed to `console.warn`.
 */
async function watchThroughEdit(css: string): Promise<{ builds: string[][]; warned: string }> {
    const root = tailwindProject('csszyx-wp-prefix-watch-', {
        'src/index.css': STOCK,
        'src/index.js': 'export const ready = true;\n',
        // Walked by the prescan, never imported: the stylesheet edit is the
        // only thing that can trigger the second build.
        'src/App.tsx': APP,
    });
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
    });
    const compiler = webpack({
        mode: 'development',
        devtool: false,
        context: root,
        entry: './src/index.js',
        output: { path: join(root, 'dist'), filename: 'bundle.js' },
        externals: { '@csszyx/runtime': 'commonjs @csszyx/runtime' },
        plugins: [webpackPlugin({ build: { cache: false }, production: { mangle: false } })],
    });
    const builds: string[][] = [];
    await new Promise<void>((resolve, reject) => {
        let guard: NodeJS.Timeout | undefined;
        const finish = () => {
            clearTimeout(guard);
            watching.close(() => compiler.close(() => resolve()));
        };
        const watching = compiler.watch({ aggregateTimeout: 20, poll: 60 }, (error, stats) => {
            if (error) {
                reject(error);
                return;
            }
            builds.push((stats?.compilation.errors ?? []).map(entry => entry.message));
            if (builds.length === 1) {
                writeFileSync(join(root, 'src/index.css'), css, 'utf8');
                // A stylesheet the build does not depend on never rebuilds;
                // stop waiting rather than hang until the test times out.
                guard = setTimeout(finish, 15_000);
                return;
            }
            finish();
        });
    });
    return { builds, warned: warnings.join('\n') };
}

describe('a Tailwind prefix that changes during a webpack watch session', () => {
    it('fails the rebuild with an error that says to restart', async () => {
        const { builds } = await watchThroughEdit('@import "tailwindcss" prefix(tw);\n');

        expect(builds).toHaveLength(2);
        const errors = (builds[1] ?? []).join('\n');
        expect(errors).toContain('changed the Tailwind prefix from no prefix to `tw`');
        expect(errors).toContain('help: stop the watch and start it again');
        // Reported by the compile hook alone, not again by the build-start hook.
        const reported = (builds[1] ?? []).filter(message =>
            message.includes('changed the Tailwind prefix'),
        );
        expect(reported).toHaveLength(1);
    }, 60_000);

    it('rebuilds quietly for a stylesheet edit that leaves the prefix alone', async () => {
        const { builds } = await watchThroughEdit(`${STOCK}.card { color: red; }\n`);

        expect(builds).toHaveLength(2);
        expect(builds[1]).toEqual([]);
    }, 60_000);

    it('warns and keeps the prefix it last read when an edit breaks the stylesheet', async () => {
        const { builds, warned } = await watchThroughEdit(`${STOCK}@import "./gone.css";\n`);

        expect(builds).toHaveLength(2);
        expect(builds[1]?.join('\n')).not.toContain('changed the Tailwind prefix');
        expect(warned).toContain('did not compile');
        expect(warned).toContain('keeps the prefix it last read');
    }, 60_000);
});
