/**
 * The Next Turbopack loader surfaces the engine's diagnostics.
 *
 * It used to read none of them, so a removed or replaced `sz` key, an unknown
 * key or an unresolvable spread — reports the Vite and webpack lanes print in
 * every mode — never reached a Turbopack user. They go through the loader's
 * own `emitWarning`, which Turbopack turns into an issue Next prints (and
 * dedupes) in the terminal and the dev overlay, with the gating the other
 * lanes apply.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportNextLoaderDiagnostics } from '../src/next-loader-diagnostics.js';
import { runNextPrebuild } from '../src/next-prebuild.js';
import nextTurboLoader, { type NextTurboLoaderContext } from '../src/next-turbo-loader.js';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const IDENTITY = {
    nextVersion: '16.2.7',
    csszyxVersion: '0.9.0',
    compilerVersion: '0.9.0',
    nativeVersion: '0.9.0-test',
};

/**
 * Loader options for one run.
 *
 * @param mode - The Next build mode.
 * @param env - The environment the loader reads its switches from.
 * @returns Serializable loader options.
 */
function options(mode: 'development' | 'production', env: Record<string, string> = {}) {
    return {
        parserMode: 'wasm' as const,
        config: { mangleVars: false },
        writeOptions: { retryDelayMs: 0 },
        mode,
        env,
        ...IDENTITY,
    };
}

const REPLACED = 'export const App = () => <p sz={{ ordinal: true, p: 4 }} />;\n';
const CLEAN = 'export const App = () => <p sz={{ p: 4 }} />;\n';
const SPREAD = 'export const App = (props: any) => <p sz={{ ...props.x }} />;\n';

/**
 * A project holding one page with the given source.
 *
 * @param source - `src/App.tsx`.
 * @returns The root and the page path.
 */
function project(source: string): { root: string; page: string } {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-next-loader-diagnostics-'));
    tempDirs.push(root);
    writeFileSync(join(root, 'package.json'), '{ "name": "app" }\n');
    mkdirSync(join(root, 'src'), { recursive: true });
    const page = join(root, 'src/App.tsx');
    writeFileSync(page, source, 'utf8');
    return { root, page };
}

/**
 * Run the loader entry once, collecting what it warned through either channel.
 *
 * @param source - The module source.
 * @param run - How to run the loader.
 * @param run.mode - The Next build mode.
 * @param run.env - The loader's environment.
 * @param run.channel - Whether the context offers `emitWarning`, as Turbopack's does.
 * @param run.times - How many times to load the module.
 * @returns The emitted warnings and the csszyx console lines.
 */
function load(
    source: string,
    run: {
        mode?: 'development' | 'production';
        env?: Record<string, string>;
        channel?: boolean;
        times?: number;
    } = {},
): { emitted: string[]; console: string[] } {
    const { mode = 'development', env = {}, channel = true, times = 1 } = run;
    const { root, page } = project(source);
    const loaderOptions = options(mode, env);
    if (mode === 'production') {
        runNextPrebuild({ files: [page], explicitRoot: root, cwd: root, ...loaderOptions });
    }
    const emitted: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context: NextTurboLoaderContext = {
        resourcePath: page,
        rootContext: root,
        context: join(root, 'src'),
        mode,
        addDependency: () => {},
        getOptions: () => loaderOptions,
        ...(channel
            ? {
                  emitWarning: (warning: Error | string) => {
                      emitted.push(warning instanceof Error ? warning.message : warning);
                  },
              }
            : {}),
    };
    for (let index = 0; index < times; index++) {
        expect(nextTurboLoader.call(context, source)).toContain('export const App');
    }
    const lines = warn.mock.calls.map(call => String(call[0])).filter(l => l.includes('[csszyx]'));
    return { emitted, console: lines };
}

describe('Next Turbopack loader diagnostics', () => {
    it('warns once about a replaced key, through the loader channel', () => {
        const { emitted, console: lines } = load(REPLACED);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toContain('[csszyx] ');
        expect(emitted[0]).toContain('src/App.tsx');
        expect(emitted[0]).toContain('"ordinal" was replaced');
        expect(emitted[0]).toContain('{ numOrdinal: true }');
        expect(lines).toEqual([]);
    });

    it('warns about nothing for a clean source', () => {
        const { emitted, console: lines } = load(CLEAN);
        expect(emitted).toEqual([]);
        expect(lines).toEqual([]);
    });

    it('is muted by CSSZYX_QUIET_SZ_WARNINGS', () => {
        const { emitted, console: lines } = load(REPLACED, {
            env: { CSSZYX_QUIET_SZ_WARNINGS: '1' },
        });
        expect(emitted).toEqual([]);
        expect(lines).toEqual([]);
    });

    it('still warns in a production build', () => {
        const { emitted } = load(REPLACED, { mode: 'production' });
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toContain('"ordinal" was replaced');
    }, 60_000);

    it('reports an unresolvable spread in production but holds the advisory fallback', () => {
        const production = load(SPREAD, { mode: 'production' });
        expect(production.emitted).toHaveLength(1);
        expect(production.emitted[0]).toContain('unresolvable sz spread');

        // A dev server lists the advisory beside it, as the other lanes do.
        const development = load(SPREAD);
        expect(development.emitted).toHaveLength(2);
        expect(development.emitted.join('\n')).toContain('sz fallback at');
    }, 60_000);

    it('falls back to the console once per module when the runner has no channel', () => {
        // Next compiles one module once per layer it is used in; with no issue
        // pipeline to dedupe them, the loader does.
        const run = load(REPLACED, { channel: false, times: 3 });
        expect(run.console).toHaveLength(1);
        expect(run.console[0]).toContain('"ordinal" was replaced');
    });

    it('prints a console line again once the module source changes, and keeps one version per module', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const report = (source: string): void =>
            reportNextLoaderDiagnostics({
                diagnostics: ['[csszyx] "ordinal" was replaced at /p/A.tsx:1.'],
                resourcePath: '/p/A.tsx',
                source,
                mode: 'development',
                env: {},
            });
        report('first');
        report('first');
        expect(warn).toHaveBeenCalledTimes(1);
        // Only the version last reported is remembered, so the record cannot
        // grow with the edits of a long session.
        report('second');
        report('first');
        expect(warn).toHaveBeenCalledTimes(3);
    });
});
