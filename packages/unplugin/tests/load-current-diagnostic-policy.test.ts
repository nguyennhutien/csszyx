/**
 * Reading `csszyx.config` again inside a process that already loaded it.
 *
 * Node keeps an imported module by URL for the life of the process, so a
 * second in-process load reads an edited module the config imports as the
 * process first read it. `loadCurrentDiagnosticPolicy` stays in process while
 * that cannot happen and loads in a child process once it can; the child
 * never rejects — a run that fails is a problem on the file, as a config that
 * does not load is.
 *
 * The child loads the built entry, so these need `@csszyx/unplugin` built.
 */
import {
    closeSync,
    fstatSync,
    ftruncateSync,
    futimesSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    writeFileSync,
    writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeDiagnosticPolicyState } from '../src/csszyx-config-file.js';
import { createDiagnosticPolicy } from '../src/diagnostic-policy.js';
import {
    diagnosticPolicyInputs,
    diagnosticPolicyInputsCurrent,
    diagnosticPolicyWatchFiles,
} from '../src/diagnostic-policy-inputs.js';
import {
    childExecArgv,
    loadCurrentDiagnosticPolicy,
    loadDiagnosticPolicyInChild,
    syncLaneDiagnosticPolicy,
} from '../src/sync-lane-policy.js';

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

/**
 * A project holding the given files.
 *
 * @param files - Files by name.
 * @returns The root.
 */
function project(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-current-policy-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), '{ "name": "app", "type": "module" }\n');
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
    return root;
}

/**
 * The one problem a failed child run reports.
 *
 * @param config - `csszyx.config.mjs`.
 * @returns Its message.
 */
async function childProblem(config: string): Promise<string> {
    const loaded = await loadDiagnosticPolicyInChild(project({ 'csszyx.config.mjs': config }));
    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]).toMatchObject({
        severity: 'error',
        path: 'csszyx.config.mjs',
        fileIgnored: true,
    });
    expect(loaded.policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe(
        createDiagnosticPolicy().levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' }),
    );
    return loaded.problems[0]?.message as string;
}

describe('a config load in a child process', () => {
    it('reads the file, the levels and the problems as a load in this process would', async () => {
        const root = project({
            'csszyx.config.mjs':
                'export default { diagnostics: { rules: { "unknown-key": "off", "unknown-keyy": "off" } } };\n',
        });
        const loaded = await loadDiagnosticPolicyInChild(root);
        expect(loaded.file).toBe(join(root, 'csszyx.config.mjs'));
        expect(loaded.policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('off');
        expect(loaded.problems).toEqual([
            expect.objectContaining({ severity: 'error', path: 'diagnostics.rules' }),
        ]);
    });

    it('starts no child for a project without a config', async () => {
        const loaded = await loadDiagnosticPolicyInChild(project({}));
        expect(loaded).toEqual({ file: null, policy: expect.anything(), problems: [] });
    });

    it('says the loader exited, with the first line it printed on stderr', async () => {
        const message = await childProblem(
            'process.stderr.write("boom\\nsecond\\n");\nprocess.exit(3);\n',
        );
        expect(message).toBe('could not be loaded: the config loader exited with status 3 (boom)');
    });

    it('says the loader exited without a detail when it printed nothing', async () => {
        expect(await childProblem('process.exit(4);\n')).toBe(
            'could not be loaded: the config loader exited with status 4',
        );
    });

    it('says the loader printed no result', async () => {
        expect(await childProblem('process.exit(0);\nexport default {};\n')).toBe(
            'could not be loaded: the config loader printed no result',
        );
    });

    it('stops waiting for a config that never finishes loading', async () => {
        vi.stubEnv('CSSZYX_JEST_CONFIG_TIMEOUT_MS', '300');
        expect(
            await childProblem(
                'setInterval(() => {}, 1000);\nawait new Promise(() => {});\nexport default {};\n',
            ),
        ).toBe('could not be loaded: it did not finish loading within 0.3 s');
    }, 30_000);

    it('stops reading a config that prints more than a lane keeps', async () => {
        const message = await childProblem(
            'process.stdout.write("x".repeat(17 * 1024 * 1024));\nexport default {};\n',
        );
        expect(message).toMatch(/^could not be loaded: stdout maxBuffer length exceeded/);
    }, 30_000);
});

describe('the Node flags a config load in a child process takes along', () => {
    it('keeps the flags that decide how modules load, and only those', () => {
        expect(
            childExecArgv([
                '--inspect-brk',
                '--import',
                'tsx',
                '--require=./hook.cjs',
                '-r',
                'dotenv/config',
                '--loader=ts-node/esm',
                '--experimental-loader',
                './loader.mjs',
                '--conditions',
                'development',
                '-C',
                'custom',
                '--experimental-strip-types',
                '--no-experimental-require-module',
                '--eval',
                'console.log(1)',
                '--test',
                '--test-reporter',
                'spec',
                '--experimental-test-coverage',
                '--watch',
                '--watch-path',
                'src',
                '--inspect=9230',
                '--max-old-space-size=4096',
            ]),
        ).toEqual([
            '--import',
            'tsx',
            '--require=./hook.cjs',
            '-r',
            'dotenv/config',
            '--loader=ts-node/esm',
            '--experimental-loader',
            './loader.mjs',
            '--conditions',
            'development',
            '-C',
            'custom',
            '--experimental-strip-types',
            '--no-experimental-require-module',
        ]);
    });

    /**
     * A project whose config reads its level from what an `--import` script
     * set, as a config that loads only through a registered loader does.
     *
     * @returns The root and the flags that register the script.
     */
    function loaderProject(): { root: string; flags: string[] } {
        const root = project({
            'csszyx.config.mjs':
                'export default { diagnostics: { rules: { "unknown-key": globalThis.__csszyxFakeLoader ?? "error" } } };\n',
            'fake-loader.mjs': 'globalThis.__csszyxFakeLoader = "off";\n',
        });
        return { root, flags: ['--inspect-port=0', '--import', join(root, 'fake-loader.mjs')] };
    }

    /**
     * Run with this process started under other Node flags.
     *
     * @param flags - `process.execArgv` for the call.
     * @param run - The call.
     * @returns What it returned.
     */
    async function withExecArgv<T>(flags: string[], run: () => T | Promise<T>): Promise<T> {
        const saved = process.execArgv;
        process.execArgv = flags;
        try {
            return await run();
        } finally {
            process.execArgv = saved;
        }
    }

    it('loads, in a fresh child, a config that needs the loader this process was started with', async () => {
        const { root, flags } = loaderProject();
        const loaded = await withExecArgv(flags, () => loadDiagnosticPolicyInChild(root));
        expect(loaded.problems).toEqual([]);
        expect(loaded.policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('off');
    });

    it('loads, in the jest lane’s child, a config that needs the loader jest was started with', async () => {
        const { root, flags } = loaderProject();
        const { policy } = await withExecArgv(flags, () =>
            syncLaneDiagnosticPolicy(root, { lane: 'jest', loadWithoutState: true }),
        );
        expect(policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('off');
    });
});

describe('a config load that reads every imported module as it is now', () => {
    const CONFIG =
        "import rules from './levels.mjs';\nexport default { diagnostics: { rules } };\n";

    it('loads again in this process while no imported module changed', async () => {
        const root = project({
            'csszyx.config.mjs': CONFIG,
            'levels.mjs': 'export default { "unknown-key": "off" };\n',
        });
        const first = await loadCurrentDiagnosticPolicy(root, diagnosticPolicyInputs(root));
        expect(first.policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('off');
        const again = await loadCurrentDiagnosticPolicy(root, diagnosticPolicyInputs(root));
        expect(again.policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('off');
    });

    it('says a module the config imports is gone instead of keeping the levels it set', async () => {
        const root = project({
            'csszyx.config.mjs': CONFIG,
            'levels.mjs': 'export default { "unknown-key": "off" };\n',
        });
        const first = await loadCurrentDiagnosticPolicy(root, diagnosticPolicyInputs(root));
        expect(first.policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('off');
        rmSync(join(root, 'levels.mjs'));
        const loaded = await loadCurrentDiagnosticPolicy(root, diagnosticPolicyInputs(root));
        expect(loaded.problems).toEqual([
            expect.objectContaining({
                severity: 'error',
                message: expect.stringContaining('could not be loaded'),
            }),
        ]);
        expect(loaded.policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe(
            createDiagnosticPolicy().levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' }),
        );
    });

    it('reads a module the config imports once it is created', async () => {
        const root = project({ 'csszyx.config.mjs': CONFIG });
        const first = await loadCurrentDiagnosticPolicy(root, diagnosticPolicyInputs(root));
        expect(first.problems).toHaveLength(1);
        writeFileSync(join(root, 'levels.mjs'), 'export default { "unknown-key": "off" };\n');
        const loaded = await loadCurrentDiagnosticPolicy(root, diagnosticPolicyInputs(root));
        expect(loaded.problems).toEqual([]);
        expect(loaded.policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('off');
    });

    it('reads a module whose size changed under the same time', async () => {
        const root = project({
            'csszyx.config.mjs': CONFIG,
            'levels.mjs': 'export default { "unknown-key": "off" };\n',
        });
        const levels = join(root, 'levels.mjs');
        await loadCurrentDiagnosticPolicy(root, diagnosticPolicyInputs(root));
        // Through one descriptor, so the time put back is the one this file had.
        const fd = openSync(levels, 'r+');
        const { mtime } = fstatSync(fd);
        ftruncateSync(fd);
        writeSync(fd, 'export default { "unknown-key": "error" };\n', 0);
        futimesSync(fd, mtime, mtime);
        closeSync(fd);
        const loaded = await loadCurrentDiagnosticPolicy(root, diagnosticPolicyInputs(root));
        expect(loaded.policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe('error');
    });
});

describe('whether the files a policy was read from are as they were', () => {
    it('reads a config created, replaced or deleted since as a change', () => {
        const root = project({});
        const none = diagnosticPolicyInputs(root);
        expect(diagnosticPolicyInputsCurrent(root, none)).toBe(true);
        writeFileSync(join(root, 'csszyx.config.mjs'), 'export default {};\n');
        expect(diagnosticPolicyInputsCurrent(root, none)).toBe(false);
        const mjs = diagnosticPolicyInputs(root);
        expect(diagnosticPolicyInputsCurrent(root, mjs)).toBe(true);
        // `.ts` is read before `.mjs`.
        writeFileSync(join(root, 'csszyx.config.ts'), 'export default {};\n');
        expect(diagnosticPolicyInputsCurrent(root, mjs)).toBe(false);
    });

    it('watches every name the config can have and each module it imports, once', () => {
        const root = project({
            'csszyx.config.mjs': "import './a.mjs';\nimport './a.mjs';\nexport default {};\n",
            'a.mjs': 'export {};\n',
        });
        expect(diagnosticPolicyWatchFiles(root, diagnosticPolicyInputs(root))).toEqual([
            join(root, 'csszyx.config.ts'),
            join(root, 'csszyx.config.mts'),
            join(root, 'csszyx.config.js'),
            join(root, 'csszyx.config.mjs'),
            join(root, 'a.mjs'),
        ]);
    });
});

describe('a state file a sync lane reads', () => {
    it('keeps the built-in levels for a state file that is JSON but not an object', () => {
        const root = project({ 'csszyx.config.mjs': 'export default {};\n' });
        writeDiagnosticPolicyState(root, createDiagnosticPolicy(), diagnosticPolicyInputs(root));
        writeFileSync(join(root, '.csszyx/diagnostic-policy.json'), 'null\n');
        const resolved = syncLaneDiagnosticPolicy(root, {
            lane: 'the Turbopack loader',
            loadWithoutState: false,
        });
        expect(resolved.inputs).toEqual([]);
    });

    it('says once that a state file of another format is not used, naming the command that writes it', () => {
        const root = project({});
        writeDiagnosticPolicyState(
            root,
            createDiagnosticPolicy({ rules: { 'unknown-key': 'off' } }),
        );
        const file = join(root, '.csszyx/diagnostic-policy.json');
        writeFileSync(file, readFileSync(file, 'utf8').replace(/"format":\d+/, '"format":7'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ask = () =>
            syncLaneDiagnosticPolicy(root, {
                lane: 'the Turbopack loader',
                loadWithoutState: false,
            });
        expect(ask().policy.levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' })).toBe(
            createDiagnosticPolicy().levelOf({ rule: 'sz-diagnostic', kind: 'unknown-key' }),
        );
        ask();
        const lines = warn.mock.calls.map(call => String(call[0]));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('is in format 7');
        expect(lines[0]).toContain('`csszyx next prebuild`');
        warn.mockRestore();
    });
});
