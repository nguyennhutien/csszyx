/**
 * Every watch lane prints a module's findings again at the level an edit to
 * `csszyx.config`, or to a module it imports, gives them.
 *
 * A watch rebuild keeps the modules that did not change, and a kept module
 * says nothing: the finding it listed under the old level stays the last word
 * on it. So each module that reported a finding depends on the files the
 * levels come from, and the rebuild an edit to one of them starts lowers that
 * module again under the levels the edit set.
 *
 * Each case drives the real bundler's real watcher; what counts is what
 * reached the console.
 */
import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as esbuild from 'esbuild';
import { watch as rollupWatch } from 'rollup';
import { build as viteBuild } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import webpack from 'webpack';

import { esbuildPlugin, rollupPlugin, vitePlugin, webpackPlugin } from '../src/unplugin.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

const UNKNOWN_LINE = '`workBreak` is not an sz property.';
const LEVELS = 'csszyx.levels.mjs';
const OFF = 'export default { "unknown-key": "off" };\n';
const WARN = 'export default { "unknown-key": "warn" };\n';
const PLUGIN_OPTIONS = { build: { cache: false }, production: { mangle: false } } as const;

/**
 * Where the levels are written: in the config, in a module it imports, or in
 * a config the session starts without.
 */
type Holder = 'config' | 'import' | 'created config';

/** The files each holder starts with, the finding turned off where there is a config. */
const LEVEL_FILES: Record<Holder, Record<string, string>> = {
    config: {
        'csszyx.config.mjs':
            'export default { diagnostics: { rules: { "unknown-key": "off" } } };\n',
    },
    import: {
        'csszyx.config.mjs': `import rules from './${LEVELS}';\nexport default { diagnostics: { rules } };\n`,
        [LEVELS]: OFF,
    },
    'created config': {},
};

/**
 * A project whose one imported module reports an unknown key, which the
 * levels first turn off. Every file is dated an hour back, so a watcher
 * never takes its own start for an edit.
 *
 * @param holder - Where the levels live.
 * @returns The project root.
 */
function project(holder: Holder): string {
    const root = tailwindProject('csszyx-config-watch-', {
        'package.json': '{ "name": "app", "type": "module" }\n',
        'src/index.css': '@import "tailwindcss";\n',
        'src/index.js': "import { a } from './a.js';\nexport const ready = a;\n",
        'src/a.js': "import { szr } from 'csszyx';\nexport const a = szr({ workBreak: 'all' });\n",
        ...LEVEL_FILES[holder],
    });
    const settled = new Date(Date.now() - 60 * 60 * 1000);
    for (const file of ['src/index.css', 'src/index.js', 'src/a.js']) {
        utimesSync(join(root, file), settled, settled);
    }
    if (holder !== 'created config') utimesSync(join(root, 'csszyx.config.mjs'), settled, settled);
    if (holder === 'import') utimesSync(join(root, LEVELS), settled, settled);
    return root;
}

/**
 * Turn the finding on where the levels live; raise it to `error` in the
 * config created mid-session, which the defaults already list.
 *
 * @param root - The project root.
 * @param holder - Where the levels live.
 */
function raiseLevel(root: string, holder: Holder): void {
    if (holder === 'created config') {
        writeFileSync(
            join(root, 'csszyx.config.mjs'),
            'export default { diagnostics: { rules: { "unknown-key": "error" } } };\n',
        );
    } else if (holder === 'config') {
        writeFileSync(
            join(root, 'csszyx.config.mjs'),
            'export default { diagnostics: { rules: { "unknown-key": "warn" } } };\n',
        );
    } else {
        writeFileSync(join(root, LEVELS), WARN);
    }
}

/**
 * Keep every line printed to `console.warn`.
 *
 * @returns The live list.
 */
function consoleLines(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    });
    return lines;
}

/**
 * How many lines name the finding.
 *
 * @param lines - The lines.
 * @returns The count.
 */
function findings(lines: readonly string[]): number {
    return lines.filter(line => line.includes(UNKNOWN_LINE)).length;
}

/** What one watch session reported. */
interface Outcome {
    /** Findings printed once the first build ended. */
    first: number;
    /** Findings printed by the end. */
    last: number;
}

/**
 * Drive a watch: after the first build, raise the level; end once a build
 * prints the finding, or after a budget no rebuild should need.
 *
 * @param start - Starts the watch; calls `built` after every build and
 *        returns how to stop it.
 * @param root - The project root.
 * @param holder - Where the levels live.
 * @returns What was printed.
 */
async function throughEdit(
    start: (built: () => void) => Promise<() => Promise<void>>,
    root: string,
    holder: Holder,
): Promise<Outcome> {
    const lines = consoleLines();
    let first = -1;
    let done: () => void = () => {};
    const finished = new Promise<void>(resolve => {
        done = resolve;
    });
    let guard: NodeJS.Timeout | undefined;
    let again: NodeJS.Timeout | undefined;
    const built = (): void => {
        if (first === -1) {
            first = findings(lines);
            raiseLevel(root, holder);
            // The first build ends before a watcher such as rollup's has
            // started listening, and on a loaded machine the edit can land in
            // that gap. Writing the same levels again until a rebuild prints
            // stands in for a person, who edits seconds later.
            again = setInterval(() => raiseLevel(root, holder), 1_000);
            // A module that does not depend on the levels never rebuilds.
            guard = setTimeout(done, 15_000);
            return;
        }
        if (findings(lines) > first) done();
    };
    const stop = await start(built);
    await finished;
    // Counted when the session ends, before a rewrite still in flight can
    // start one more rebuild.
    const last = findings(lines);
    clearInterval(again);
    clearTimeout(guard);
    await stop();
    return { first, last };
}

const LANES: Record<string, (root: string, built: () => void) => Promise<() => Promise<void>>> = {
    async webpack(root, built) {
        const compiler = webpack({
            mode: 'development',
            devtool: false,
            context: root,
            entry: './src/index.js',
            output: { path: join(root, 'dist'), filename: 'bundle.js' },
            externals: { csszyx: 'commonjs csszyx', '@csszyx/runtime': 'commonjs @csszyx/runtime' },
            plugins: [webpackPlugin(PLUGIN_OPTIONS)],
        });
        const watching = compiler.watch({ aggregateTimeout: 20, poll: 60 }, error => {
            if (error === null) built();
        });
        return () =>
            new Promise<void>(resolve => watching.close(() => compiler.close(() => resolve())));
    },
    async rollup(root, built) {
        const watcher = rollupWatch({
            input: join(root, 'src/index.js'),
            external: id => id === 'csszyx' || id.startsWith('@csszyx/'),
            plugins: rollupPlugin(PLUGIN_OPTIONS),
            output: { dir: join(root, 'dist'), format: 'es' },
            watch: {},
            onwarn: () => {},
        });
        watcher.on('event', event => {
            if (event.code === 'BUNDLE_END') {
                void event.result.close();
                built();
            }
        });
        return () => watcher.close();
    },
    async 'vite build --watch'(root, built) {
        const watcher = (await viteBuild({
            root,
            configFile: false,
            logLevel: 'silent',
            plugins: [vitePlugin(PLUGIN_OPTIONS)],
            build: {
                watch: {},
                outDir: join(root, 'dist'),
                minify: false,
                lib: { entry: join(root, 'src/index.js'), formats: ['es'], fileName: 'index' },
                rollupOptions: {
                    external: id => id === 'csszyx' || id.startsWith('@csszyx/'),
                },
            },
        })) as import('rollup').RollupWatcher;
        watcher.on('event', event => {
            if (event.code === 'BUNDLE_END') {
                void event.result.close();
                built();
            }
        });
        return () => watcher.close();
    },
    async esbuild(root, built) {
        const context = await esbuild.context({
            absWorkingDir: root,
            entryPoints: [join(root, 'src/index.js')],
            bundle: true,
            write: false,
            format: 'esm',
            external: ['csszyx', '@csszyx/*'],
            logLevel: 'silent',
            plugins: [
                esbuildPlugin(PLUGIN_OPTIONS),
                {
                    name: 'built',
                    setup(build) {
                        build.onEnd(() => built());
                    },
                },
            ],
        });
        await context.watch();
        return () => context.dispose();
    },
};

/**
 * Vite 8 builds with Rolldown, whose watcher drops a watch file that does not
 * exist yet: a config created during `vite build --watch` is read at the next
 * rebuild something else starts, not at its creation (config.mdx says so).
 */
const HOLDERS: Record<string, Holder[]> = {
    'vite build --watch': ['config', 'import'],
};

describe.each(Object.keys(LANES))('a %s watch session', lane => {
    it.each<Holder>(HOLDERS[lane] ?? ['config', 'import', 'created config'])(
        'prints a kept module’s finding again when the %s that sets its level is edited',
        async holder => {
            const root = project(holder);
            // rollup and esbuild take the project root from the working directory.
            vi.spyOn(process, 'cwd').mockReturnValue(root);
            const outcome = await throughEdit(
                built => (LANES[lane] as (typeof LANES)[string])(root, built),
                root,
                holder,
            );
            const before = holder === 'created config' ? 1 : 0;
            expect(outcome.first).toBe(before);
            expect(outcome.last).toBe(before + 1);
        },
        60_000,
    );
});
