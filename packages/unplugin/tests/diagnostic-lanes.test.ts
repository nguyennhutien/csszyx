/**
 * Every bundler lane reports engine diagnostics at the level `csszyx.config`
 * sets.
 *
 * The policy is resolved in one module, but a lane that never asks it keeps
 * printing at the built-in levels: a project that set `unknown-key` to `off`
 * would still read it from Vite, and a project on `atomic` would never see a
 * precedence note in a production log. Each lane is driven here the way its
 * bundler drives it, and only what reached the console or the loader channel
 * counts.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeDiagnosticPolicyState } from '../src/csszyx-config-file.js';
import { createDiagnosticPolicy } from '../src/diagnostic-policy.js';
import { createTransformer } from '../src/jest-transform.js';
import nextTurboLoader, { type NextTurboLoaderContext } from '../src/next-turbo-loader.js';
import { unplugin as rawInstance, vitePlugin } from '../src/unplugin.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

const UNKNOWN = "export const A = () => <div sz={{ workBreak: 'all' }} />;\n";
const PRECEDENCE =
    'export const A = ({ className }: { className?: string }) => <div className={className} sz={{ p: 4 }} />;\n';
const OFF = 'export default { diagnostics: { rules: { "unknown-key": "off" } } };\n';
const ATOMIC = 'export default { diagnostics: { preset: "atomic" } };\n';

/**
 * A project with one source file and, optionally, a config.
 *
 * @param source - `src/A.tsx`.
 * @param config - `csszyx.config.mjs`, when the case sets levels.
 * @returns The root and the file.
 */
function project(source: string, config?: string): { root: string; file: string } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-diagnostic-lanes-')));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{ "name": "app" }\n');
    const file = join(root, 'src/A.tsx');
    writeFileSync(file, source);
    if (config !== undefined) writeFileSync(join(root, 'csszyx.config.mjs'), config);
    return { root, file };
}

/**
 * Collect every csszyx line the console and the hook's own `warn` receive.
 *
 * @returns The live list, and the hook context that feeds it.
 */
function captured(): { lines: string[]; context: Record<string, unknown> } {
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    });
    const context = {
        warn: (message: unknown) => lines.push(String(message)),
        error() {},
        emitFile() {},
        addWatchFile() {},
    };
    return { lines, context };
}

/**
 * Call one Vite hook by name off the plugin array.
 *
 * @param plugins - The array `vitePlugin` returned.
 * @param context - `this` for the hook.
 * @returns Caller for one hook.
 */
function hooks(
    plugins: Record<string, unknown>[],
    context: Record<string, unknown>,
): (name: string, ...args: unknown[]) => Promise<unknown> {
    return async (name, ...args) => {
        const plugin = plugins.find(candidate => candidate && name in candidate);
        const hook = plugin?.[name];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(context, args) : undefined;
    };
}

/**
 * Transform `src/A.tsx` on Vite, as a build or a dev server.
 *
 * @param input - What to run.
 * @param input.source - The module source.
 * @param input.config - The config file, if any.
 * @param input.command - `build` or `serve`.
 * @param input.edits - Later versions of the module, transformed after it.
 * @returns Every csszyx line printed.
 */
async function vite(input: {
    source: string;
    config?: string;
    command?: 'build' | 'serve';
    edits?: string[];
}): Promise<string[]> {
    const { root, file } = project(input.source, input.config);
    const { lines, context } = captured();
    const call = hooks(
        vitePlugin({ build: { cache: false }, production: { mangle: false } }) as unknown as Record<
            string,
            unknown
        >[],
        context,
    );
    await call('configResolved', { root, command: input.command ?? 'build' });
    for (const code of [input.source, ...(input.edits ?? [])]) {
        try {
            await call('transform', code, file);
        } catch {
            /* the transform reported before any later hook failed */
        }
    }
    return lines.filter(line => line.includes('[csszyx]'));
}

describe('the Vite lane', () => {
    it('lists an unknown key with its file and line by default', async () => {
        const lines = await vite({ source: UNKNOWN });
        const said = lines.filter(line => line.includes('Unknown property "workBreak"'));
        expect(said).toHaveLength(1);
        expect(said[0]).toMatch(/src\/A\.tsx:1:\d+\n/);
    }, 60_000);

    it('prints nothing for a kind the config sets to off', async () => {
        const lines = await vite({ source: UNKNOWN, config: OFF });
        expect(lines.join('\n')).not.toContain('Unknown property');
    }, 60_000);

    it('lists a note the atomic preset raises, in a production build', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const lines = await vite({ source: PRECEDENCE, config: ATOMIC });
        expect(lines.join('\n')).toContain('takes precedence over the runtime "className"');
        expect(lines.join('\n')).not.toContain('advisory note');
    }, 60_000);

    it('counts that note instead of listing it under the recommended preset', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const lines = await vite({ source: PRECEDENCE });
        expect(lines.join('\n')).not.toContain('takes precedence over the runtime "className"');
    }, 60_000);

    it('lists a site once while the file is unchanged, and again once it is edited', async () => {
        const edited = `${UNKNOWN}// edited\n`;
        const lines = await vite({ source: UNKNOWN, command: 'serve', edits: [UNKNOWN, edited] });
        expect(lines.filter(line => line.includes('Unknown property "workBreak"'))).toHaveLength(2);
    }, 60_000);
});

describe('the webpack lane', () => {
    it('reads the level from the config before the first compile', async () => {
        const { root, file } = project(UNKNOWN, OFF);
        const { lines, context } = captured();
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const plugin = rawInstance.raw(
            { build: { cache: false }, production: { mangle: false } },
            { framework: 'webpack' },
        ) as unknown as {
            webpack: (compiler: unknown) => void;
            transform: (code: string, id: string) => unknown;
        };
        const compiles: Promise<void>[] = [];
        plugin.webpack({
            context: root,
            options: { mode: 'production' },
            hooks: {
                beforeCompile: {
                    tap: (_name: string, run: () => void) => run(),
                    tapPromise: (_name: string, run: () => Promise<void>) => {
                        compiles.push(run());
                    },
                },
                thisCompilation: { tap: () => undefined },
            },
        });
        await Promise.all(compiles);
        await plugin.transform.call(context, UNKNOWN, file);
        expect(lines.join('\n')).not.toContain('Unknown property');
    }, 60_000);
});

/**
 * Run the Turbopack loader once over `src/A.tsx`.
 *
 * @param input - What to run.
 * @param input.source - The module source.
 * @param input.policy - The policy `next prebuild` would have written.
 * @param input.mode - The Next mode.
 * @returns What the loader emitted through its channel.
 */
function turbopack(input: {
    source: string;
    policy?: Parameters<typeof createDiagnosticPolicy>[0];
    mode?: 'development' | 'production';
}): string[] {
    const { root, file } = project(input.source);
    if (input.policy !== undefined) {
        writeDiagnosticPolicyState(root, createDiagnosticPolicy(input.policy));
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emitted: string[] = [];
    const mode = input.mode ?? 'development';
    const context: NextTurboLoaderContext = {
        resourcePath: file,
        rootContext: root,
        context: join(root, 'src'),
        mode,
        addDependency: () => {},
        getOptions: () => ({
            parserMode: 'wasm',
            config: { mangleVars: false },
            writeOptions: { retryDelayMs: 0 },
            mode,
            env: {},
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            compilerVersion: '0.9.0',
            nativeVersion: '0.9.0-test',
        }),
        emitWarning: (warning: Error | string) => {
            emitted.push(warning instanceof Error ? warning.message : warning);
        },
    };
    nextTurboLoader.call(context, input.source);
    return emitted;
}

describe('the Turbopack loader', () => {
    it('reads the level next prebuild resolved into .csszyx', () => {
        expect(turbopack({ source: UNKNOWN }).join('\n')).toContain('Unknown property');
        expect(turbopack({ source: UNKNOWN, policy: { rules: { 'unknown-key': 'off' } } })).toEqual(
            [],
        );
    });

    it('names the line the engine placed the finding on', () => {
        expect(turbopack({ source: UNKNOWN })[0]).toMatch(/src\/A\.tsx:1:\d+\n/);
    });
});

describe('the jest transform', () => {
    /**
     * Transform `src/A.tsx` the way jest does.
     *
     * @param source - The module source.
     * @param policy - The policy a Next command wrote, if any.
     * @returns The csszyx lines printed.
     */
    function jest(source: string, policy?: Parameters<typeof createDiagnosticPolicy>[0]) {
        const { root, file } = project(source);
        if (policy !== undefined) writeDiagnosticPolicyState(root, createDiagnosticPolicy(policy));
        const lines: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
        });
        createTransformer({ root, cacheRoot: join(root, 'no-cache') }).process(source, file);
        return lines.filter(line => line.includes('[csszyx]'));
    }

    it('keeps an info-level note out of the test log', () => {
        expect(jest(PRECEDENCE)).toEqual([]);
    });

    it('prints it once the policy raises it', () => {
        expect(jest(PRECEDENCE, { preset: 'atomic' }).join('\n')).toContain(
            'takes precedence over the runtime "className"',
        );
    });

    it('drops a kind the policy sets to off', () => {
        expect(jest(UNKNOWN).join('\n')).toContain('Unknown property');
        expect(jest(UNKNOWN, { rules: { 'unknown-key': 'off' } })).toEqual([]);
    });
});
