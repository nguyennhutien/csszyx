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

import type { SzDiagnosticIssue } from '@csszyx/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeDiagnosticPolicyState } from '../src/csszyx-config-file.js';
import { createDiagnosticPolicy } from '../src/diagnostic-policy.js';
import { diagnosticPolicyInputs } from '../src/diagnostic-policy-inputs.js';
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
// A spread, and beside it a value the build cannot read: the spread is
// reported in every build, the advisory nudge only in development.
const SPREAD =
    'export const App = (props: any) => <p sz={{ ...props.x }}><b sz={props.s} /></p>;\n';

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
 * @param run.files - More files at the root, by name.
 * @param run.state - Write the policy file a Next command writes, from those files.
 * @returns The root, the emitted warnings, the csszyx console lines and the
 *          loader's file dependencies.
 */
function load(
    source: string,
    run: {
        mode?: 'development' | 'production';
        env?: Record<string, string>;
        channel?: boolean;
        times?: number;
        files?: Record<string, string>;
        state?: boolean;
    } = {},
): {
    root: string;
    emitted: string[];
    warnings: Error[];
    console: string[];
    dependencies: string[];
} {
    const { mode = 'development', env = {}, channel = true, times = 1, files = {} } = run;
    const { root, page } = project(source);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
    if (run.state === true) {
        writeDiagnosticPolicyState(root, createDiagnosticPolicy(), diagnosticPolicyInputs(root));
    }
    const loaderOptions = options(mode, env);
    if (mode === 'production') {
        runNextPrebuild({ files: [page], explicitRoot: root, cwd: root, ...loaderOptions });
    }
    const emitted: string[] = [];
    const warnings: Error[] = [];
    const dependencies: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context: NextTurboLoaderContext = {
        resourcePath: page,
        rootContext: root,
        context: join(root, 'src'),
        mode,
        addDependency: file => {
            dependencies.push(file);
        },
        getOptions: () => loaderOptions,
        ...(channel
            ? {
                  emitWarning: (warning: Error | string) => {
                      if (typeof warning === 'string') {
                          emitted.push(warning);
                          return;
                      }
                      warnings.push(warning);
                      emitted.push(asNextPrints(warning));
                  },
              }
            : {}),
    };
    for (let index = 0; index < times; index++) {
        expect(nextTurboLoader.call(context, source)).toContain('export const App');
    }
    const lines = warn.mock.calls.map(call => String(call[0])).filter(l => l.includes('[csszyx]'));
    return { root, emitted, warnings, console: lines, dependencies };
}

/**
 * A loader warning as Next 16 prints it: Turbopack's runner hands Next the
 * error's `name`, `message` and the frames it parses out of `stack`, and Next
 * prints `name: message`, then each frame as `[at …]` (measured on Next
 * 16.3.8). A stack line ending in `:line:col` reads as a frame.
 *
 * @param warning - What the loader emitted.
 * @returns The printed text.
 */
function asNextPrints(warning: Error): string {
    const frames = (warning.stack ?? '')
        .split('\n')
        .filter(line => /:\d+:\d+\)?$/.test(line))
        .map(line => `    [at ${line.trim()}]`);
    return [`${warning.name}: ${warning.message}`, ...frames].join('\n');
}

describe('Next Turbopack loader diagnostics', () => {
    it('warns once about a replaced key, through the loader channel', () => {
        const { emitted, warnings, console: lines } = load(REPLACED);
        expect(emitted).toHaveLength(1);
        // The engine's message carries its own header, once, naming the file
        // from the project root as the Vite and webpack lanes do.
        expect(emitted[0]).toMatch(/^\[csszyx\] removed-key: src\/App\.tsx:1:\d+\n/);
        expect(emitted[0].match(/\[csszyx\]/g)).toHaveLength(1);
        // No line of the stack reads as a frame, so Next echoes nothing.
        expect(emitted[0]).not.toContain('[at ');
        expect(warnings[0]?.stack).toBe('');
        expect(emitted[0]).toContain('`ordinal` was replaced');
        expect(emitted[0]).toContain('{ numOrdinal: true }');
        expect(lines).toEqual([]);
    });

    it('runs a module with findings again when the levels it was reported at can change', () => {
        // `next watch` rewrites the policy file on a config edit; without
        // `next watch`, the config and what it imports are what changed.
        const { root, dependencies } = load(REPLACED, {
            state: true,
            files: {
                'csszyx.config.mjs':
                    "import rules from './levels.mjs';\nexport default { diagnostics: { rules } };\n",
                'levels.mjs': 'export default {};\n',
            },
        });
        expect(dependencies).toEqual(
            expect.arrayContaining([
                join(root, '.csszyx/diagnostic-policy.json'),
                join(root, 'csszyx.config.ts'),
                join(root, 'csszyx.config.mjs'),
                join(root, 'levels.mjs'),
            ]),
        );
    });

    it('does not make a clean module depend on the levels', () => {
        const { root, dependencies } = load(CLEAN);
        expect(dependencies).not.toContain(join(root, '.csszyx/diagnostic-policy.json'));
        expect(dependencies).not.toContain(join(root, 'csszyx.config.ts'));
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
        expect(emitted[0]).toContain('`ordinal` was replaced');
        // The prebuild lowered the module first and cached it: the loader's
        // hit names the file as its own run would.
        expect(emitted[0]).toMatch(/^\[csszyx\] removed-key: src\/App\.tsx:1:\d+\n/);
    }, 60_000);

    it('reports an unresolvable spread in production but holds the advisory fallback', () => {
        const production = load(SPREAD, { mode: 'production' });
        expect(production.emitted).toHaveLength(1);
        expect(production.emitted[0]).toMatch(
            /^\[csszyx\] unresolvable-spread: src\/App\.tsx:1:\d+\n/,
        );
        expect(production.emitted[0].match(/\[csszyx\]/g)).toHaveLength(1);

        // A dev server lists the advisory beside it, as the other lanes do.
        const development = load(SPREAD);
        expect(development.emitted).toHaveLength(2);
        expect(development.emitted.join('\n')).toContain('fallback-nudge: ');
    }, 60_000);

    it('splits each line where Next joins it again, so it prints the line as written', () => {
        const warnings: Error[] = [];
        const report = (line: string, issues?: SzDiagnosticIssue[]): void =>
            reportNextLoaderDiagnostics({
                diagnostics: [line],
                issues,
                resourcePath: '/p/Split.tsx',
                source: line,
                mode: 'development',
                env: {},
                emitWarning: warning => warnings.push(warning as Error),
            });
        report(
            '[csszyx] numeric-key: /p/Split.tsx:1:1\n  `sz` received a numeric key `0`, and its value is ignored.',
            [{ code: 'numeric-key', args: { key: '0' }, line: 1, column: 1 } as SzDiagnosticIssue],
        );
        report('[csszyx] a line from before the codes');
        expect(warnings.map(warning => [warning.name, warning.message, warning.stack])).toEqual([
            [
                '[csszyx] numeric-key',
                '/p/Split.tsx:1:1\n  `sz` received a numeric key `0`, and its value is ignored.',
                '',
            ],
            // A line with no code sits under a heading naming its file.
            ['[csszyx] /p/Split.tsx', '\n  [csszyx] a line from before the codes', ''],
        ]);
        expect(warnings.map(warning => asNextPrints(warning))).toEqual([
            '[csszyx] numeric-key: /p/Split.tsx:1:1\n  `sz` received a numeric key `0`, and its value is ignored.',
            '[csszyx] /p/Split.tsx: \n  [csszyx] a line from before the codes',
        ]);
    });

    it('falls back to the console once per module when the runner has no channel', () => {
        // Next compiles one module once per layer it is used in; with no issue
        // pipeline to dedupe them, the loader does.
        const run = load(REPLACED, { channel: false, times: 3 });
        expect(run.console).toHaveLength(1);
        expect(run.console[0]).toContain('`ordinal` was replaced');
    });

    it('prints a console line again once the module source changes, and keeps one version per module', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const report = (source: string): void =>
            reportNextLoaderDiagnostics({
                diagnostics: [
                    '[csszyx] removed-key: /p/A.tsx:1:1\n  `ordinal` was replaced, and nothing is emitted for it.\n  docs: https://csszyx.com/e/removed-key',
                ],
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

    it('reads a config created after the policy file recorded none', () => {
        // The cached policy came from a project without a config: nothing it
        // lists changed, and a check of its inputs alone would keep it.
        const { root } = project(CLEAN);
        writeDiagnosticPolicyState(root, createDiagnosticPolicy(), []);
        const emitted: string[] = [];
        const run = (source: string): void =>
            reportNextLoaderDiagnostics({
                diagnostics: [
                    '[csszyx] removed-key: src/App.tsx:1:1\n  `ordinal` was replaced, and nothing is emitted for it.\n  docs: https://csszyx.com/e/removed-key',
                ],
                issues: [
                    {
                        code: 'removed-key',
                        args: { form: 'replaced', key: 'ordinal', replacement: 'numOrdinal: true' },
                        line: 1,
                        column: 1,
                    },
                ],
                root,
                resourcePath: join(root, 'src/App.tsx'),
                source,
                mode: 'development',
                env: {},
                emitWarning: warning => emitted.push(String(warning)),
            });
        run('before');
        expect(emitted).toHaveLength(1);
        writeFileSync(
            join(root, 'csszyx.config.mjs'),
            "export default { diagnostics: { rules: { 'removed-key': 'off' } } };\n",
        );
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        run('after');
        expect(emitted).toHaveLength(1);
    });

    it('prints a console line again when an undo brings back what an edit fixed', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const report = (source: string, diagnostics: string[]): void =>
            reportNextLoaderDiagnostics({
                diagnostics,
                resourcePath: '/p/Undo.tsx',
                source,
                mode: 'development',
                env: {},
            });
        const finding = [
            '[csszyx] removed-key: /p/Undo.tsx:1:1\n  `ordinal` was replaced, and nothing is emitted for it.\n  docs: https://csszyx.com/e/removed-key',
        ];
        report('broken', finding);
        report('fixed', []);
        report('broken', finding);
        expect(warn).toHaveBeenCalledTimes(2);
    });
});
