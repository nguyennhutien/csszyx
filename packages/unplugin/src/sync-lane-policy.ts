/**
 * The diagnostic policy of the lanes that run synchronously and cannot import
 * `csszyx.config`: jest and the Next Turbopack loader.
 *
 * Both read what `csszyx next prebuild`/`watch` resolved into
 * `.csszyx/diagnostic-policy.json` while every file that record lists — the
 * config and each module it imports — is as recorded. Once one of them
 * changed, the record holds old levels, and the lane loads the config itself:
 * jest calls a transformer synchronously and `import()` is not, so the loader
 * runs in a child process. Its problems are printed in the text the bundler
 * lanes print. Jest does the same without a record at all, for a jest-only
 * run; the loader keeps the built-in levels there, as it always has.
 *
 * The same child serves the lanes that read the config again inside one
 * process — a dev server, a watch, `csszyx next watch`
 * ({@link loadCurrentDiagnosticPolicy}): Node keeps every module the first
 * load imported, so only a fresh process reads an edited one.
 *
 * @module
 */
import { execFile, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    type DiagnosticPolicyStateFile,
    diagnosticPolicyFromState,
    diagnosticPolicyStatePath,
    type FoundConfigFile,
    findCsszyxConfigFile,
    isReadableDiagnosticPolicyState,
    type LoadedDiagnosticPolicy,
    loadDiagnosticPolicy,
    readDiagnosticPolicyState,
} from './csszyx-config-file.js';
import {
    createDiagnosticPolicy,
    type DiagnosticConfigProblem,
    type DiagnosticPolicy,
    diagnosticConfigProblemsMessage,
} from './diagnostic-policy.js';
import {
    type DiagnosticPolicyInput,
    diagnosticPolicyInputs,
    diagnosticPolicyInputsCurrent,
} from './diagnostic-policy-inputs.js';

/**
 * Marks the line the config loader prints its result on. A config that logs
 * while it loads — a `console.log`, a dotenv banner — writes to the same
 * stdout, so the result is the line after this mark, wherever it lands.
 */
const RESULT_MARK = '@@csszyx-jest-config-result@@';

/**
 * Load `csszyx.config` in a child process and print the file it read, its
 * resolved policy and its problems as JSON on its own marked line of stdout.
 */
const LOAD_CONFIG = `
const [, entry, root] = process.argv;
const { loadDiagnosticPolicy } = await import(entry);
const { EOL } = await import('node:os');
const loaded = await loadDiagnosticPolicy(root);
process.stdout.write(EOL + ${JSON.stringify(RESULT_MARK)} + JSON.stringify({
    file: loaded.file,
    state: loaded.policy.toJSON(),
    problems: loaded.problems,
}) + EOL);
`;

/** How long a lane waits for the config to load before keeping the defaults. */
const CONFIG_LOAD_TIMEOUT_MS = 30_000;

/** What the config loader may print before a lane stops reading it. */
const CONFIG_LOAD_MAX_BUFFER = 16 * 1024 * 1024;

/** What the config loader printed as its result. */
interface LoadedConfig {
    file: string | null;
    state: Parameters<typeof diagnosticPolicyFromState>[0];
    problems: DiagnosticConfigProblem[];
}

/**
 * Read the loader's result off its stdout.
 *
 * @param stdout - Everything the child printed.
 * @returns The result, or null when no marked line parses.
 */
function loadedConfigOf(stdout: string): LoadedConfig | null {
    const start = stdout.lastIndexOf(RESULT_MARK);
    if (start === -1) return null;
    const line = stdout.slice(start + RESULT_MARK.length).split('\n', 1)[0] as string;
    try {
        return JSON.parse(line) as LoadedConfig;
    } catch {
        return null;
    }
}

/**
 * The line a lane prints when it keeps the defaults because the config's
 * levels could not be read.
 *
 * @param lane - The lane, as the line names it: `jest`, `the Turbopack loader`.
 * @param configName - The config's file name.
 * @param reason - Why, without a closing full stop.
 * @returns The warning, `[csszyx]`-prefixed.
 */
function configNotReadMessage(lane: string, configName: string, reason: string): string {
    return (
        `[csszyx] ${lane} could not read the levels ${configName} sets: ${reason}.\n` +
        '  note: this worker reports at the levels in .csszyx/diagnostic-policy.json, or the ' +
        'recommended levels without that file.'
    );
}

/** Node flags, spelled without a value, that take the next argument as theirs. */
const FLAGS_WITH_VALUE = new Set([
    '--import',
    '--loader',
    '--experimental-loader',
    '--require',
    '-r',
    '--conditions',
    '-C',
    '--experimental-default-type',
]);

/**
 * Whether a Node flag decides how modules load: a loader or a preload
 * registered with `--import`, `--loader` or `--require`, an export condition,
 * or an `--experimental-*` switch (type stripping among them).
 *
 * @param flag - The flag, without its `=value`.
 * @returns True for a flag the config load needs too.
 */
function decidesModuleLoading(flag: string): boolean {
    if (FLAGS_WITH_VALUE.has(flag)) return true;
    const experimental =
        flag.startsWith('--experimental-') || flag.startsWith('--no-experimental-');
    // A test runner switch would make the child a test run of its own.
    return experimental && !flag.includes('-experimental-test');
}

/**
 * The flags of this process a config load in a child process takes along.
 *
 * A config that loads only through a loader this process was started with —
 * `--import tsx` on a Node that strips no types — loads here and would fail in
 * a bare child. The flags that start a debugger, a test run, a watch or an
 * evaluation stay behind: each would turn the child into something else.
 *
 * @param execArgv - This process's `process.execArgv`.
 * @returns The flags to pass on, each with its value.
 */
export function childExecArgv(execArgv: readonly string[]): string[] {
    const kept: string[] = [];
    for (let index = 0; index < execArgv.length; index++) {
        const arg = execArgv[index] as string;
        const equals = arg.indexOf('=');
        const flag = equals === -1 ? arg : arg.slice(0, equals);
        if (!flag.startsWith('-') || !decidesModuleLoading(flag)) continue;
        kept.push(arg);
        const value = execArgv[index + 1];
        if (equals === -1 && FLAGS_WITH_VALUE.has(flag) && value !== undefined) {
            kept.push(value);
            index++;
        }
    }
    return kept;
}

/**
 * How the child is started: Node, the loader script, the entry and the root.
 *
 * @param root - The project root.
 * @returns The arguments, and the time it is given.
 */
function childArguments(root: string): { timeout: number; args: string[] } {
    // One path from both builds of this file: `src/` and `dist/` sit side by
    // side, so the entry is found the same way from either.
    const entry = new URL('../dist/diagnostics.mjs', import.meta.url).href;
    const timeout = Number(process.env.CSSZYX_JEST_CONFIG_TIMEOUT_MS) || CONFIG_LOAD_TIMEOUT_MS;
    return {
        timeout,
        args: [
            ...childExecArgv(process.execArgv),
            '--input-type=module',
            '-e',
            LOAD_CONFIG,
            entry,
            root,
        ],
    };
}

/**
 * Why a child run gave no result, or null when it printed one.
 *
 * @param error - The spawn's error, when it failed or timed out.
 * @param status - Its exit status.
 * @param timeout - The budget it had, in ms.
 * @param loaded - What its stdout held.
 * @returns The reason, without a closing full stop.
 */
function childFailure(
    error: Error | null | undefined,
    status: number | null,
    timeout: number,
    loaded: LoadedConfig | null,
): string | null {
    if (error) {
        return (error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ||
            (error as { killed?: boolean }).killed === true
            ? `it did not finish loading within ${timeout / 1000} s`
            : (error.message.split('\n', 1)[0] as string);
    }
    if (status !== 0) return `the config loader exited with status ${status}`;
    return loaded === null ? 'the config loader printed no result' : null;
}

/**
 * Load the config in a child process.
 *
 * @param root - The project root.
 * @param found - The config file.
 * @param lane - The lane, for the line a failure prints.
 * @returns The policy; the state file's, or the defaults, when the child fails.
 */
function loadInChild(root: string, found: FoundConfigFile, lane: string): DiagnosticPolicy {
    const configName = path.basename(found.file);
    const { timeout, args } = childArguments(root);
    const result = spawnSync(process.execPath, args, {
        encoding: 'utf8',
        timeout,
        maxBuffer: CONFIG_LOAD_MAX_BUFFER,
    });
    if (result.stderr) console.warn(result.stderr);
    const loaded = result.error === undefined ? loadedConfigOf(result.stdout) : null;
    const failure = childFailure(result.error, result.status, timeout, loaded);
    if (failure !== null) {
        // A loader that exited on an error has said why on stderr.
        if (result.error !== undefined || result.status === 0) {
            console.warn(configNotReadMessage(lane, configName, failure));
        }
        return readDiagnosticPolicyState(root);
    }
    const { problems, state } = loaded as LoadedConfig;
    if (problems.length > 0) console.warn(diagnosticConfigProblemsMessage(configName, problems));
    return diagnosticPolicyFromState(state);
}

/**
 * Load the config in a child process, without blocking: a fresh Node whose
 * module cache holds nothing this process imported.
 *
 * Never rejects. A child that fails is a problem `error` on the file, the
 * defaults apply, as for a config that does not load.
 *
 * @param root - The project root.
 * @returns What {@link loadDiagnosticPolicy} would return in a fresh process.
 */
export async function loadDiagnosticPolicyInChild(root: string): Promise<LoadedDiagnosticPolicy> {
    const found = findCsszyxConfigFile(root);
    if (found === null) return { file: null, policy: createDiagnosticPolicy(), problems: [] };
    const { timeout, args } = childArguments(root);
    const run = await new Promise<{ error: Error | null; stdout: string; stderr: string }>(
        resolve => {
            execFile(
                process.execPath,
                args,
                { encoding: 'utf8', timeout, maxBuffer: CONFIG_LOAD_MAX_BUFFER },
                (error, stdout, stderr) => resolve({ error, stdout, stderr }),
            );
        },
    );
    const loaded = run.error === null ? loadedConfigOf(run.stdout) : null;
    const exited = (run.error as { code?: unknown } | null)?.code;
    const failure =
        typeof exited === 'number'
            ? childFailure(null, exited, timeout, null)
            : childFailure(run.error, 0, timeout, loaded);
    if (failure === null) {
        const { file, state, problems } = loaded as LoadedConfig;
        return { file, policy: diagnosticPolicyFromState(state), problems };
    }
    const detail = run.stderr.trim().split('\n', 1)[0];
    const reason = detail ? `${failure} (${detail})` : failure;
    return {
        file: found.file,
        policy: createDiagnosticPolicy(),
        problems: [
            {
                severity: 'error',
                path: path.basename(found.file),
                message: `could not be loaded: ${reason}`,
                fileIgnored: true,
            },
        ],
    };
}

/**
 * Each module a config load in this process imported, with the time and size
 * it had then (`<mtimeMs>:<size>`), or `missing` for a name it found no file at. Node keeps an imported module by URL for the life of the
 * process; only the config itself is read again (`?mtime=`).
 */
const importedHere = new Map<string, string>();

/**
 * Load the project's config so that every module it imports is read as it is
 * now.
 *
 * In this process while each module it imports is new to the process or as
 * the process first imported it — the cheap path, and the only one a session
 * whose config imports nothing takes. Otherwise in a child process
 * ({@link loadDiagnosticPolicyInChild}, ~40–60 ms): an in-process import
 * would serve the edited module as first read, and the levels it sets would
 * be the old ones under inputs that read as new.
 *
 * @param root - The project root.
 * @param inputs - What {@link diagnosticPolicyInputs} returned just before.
 * @returns The file, the policy and the problems.
 */
export function loadCurrentDiagnosticPolicy(
    root: string,
    inputs: readonly DiagnosticPolicyInput[],
): Promise<LoadedDiagnosticPolicy> {
    // The config is first; it is read again by URL on every load.
    // A name with no file is recorded as missing: a module this process
    // imported and that is gone since, or one that appeared since the process
    // failed to import it, reads as changed like an edit.
    const imports = inputs.slice(1).map(input => ({
        file: path.resolve(root, input.file),
        stamp: input.missing === true ? 'missing' : `${input.mtimeMs}:${input.size}`,
    }));
    const stale = imports.some(({ file, stamp }) => {
        const held = importedHere.get(file);
        return held !== undefined && held !== stamp;
    });
    if (stale) return loadDiagnosticPolicyInChild(root);
    for (const { file, stamp } of imports) importedHere.set(file, stamp);
    return loadDiagnosticPolicy(root);
}

/**
 * The state file as written, without judging it.
 *
 * @param root - The project root.
 * @returns Its fields, or null when it is missing or does not parse.
 */
function readStateFile(root: string): Partial<DiagnosticPolicyStateFile> | null {
    try {
        const parsed: unknown = JSON.parse(readFileSync(diagnosticPolicyStatePath(root), 'utf8'));
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Whether a state file still describes the project's config: of this format,
 * written for the config file the project has now (or for none), and with
 * every file it lists unchanged.
 *
 * @param root - The project root.
 * @param state - The state file's fields.
 * @returns The inputs it lists when it is current, or null.
 */
function currentInputs(
    root: string,
    state: Partial<DiagnosticPolicyStateFile>,
): DiagnosticPolicyInput[] | null {
    const { inputs } = state;
    if (!isReadableDiagnosticPolicyState(root, state) || !Array.isArray(inputs)) return null;
    return diagnosticPolicyInputsCurrent(root, inputs) ? inputs : null;
}

/** A sync lane's policy, and the files whose change makes it stale. */
export interface SyncLanePolicy {
    policy: DiagnosticPolicy;
    /** Ask {@link diagnosticPolicyInputsCurrent} of these before reusing it. */
    inputs: DiagnosticPolicyInput[];
}

/**
 * The policy a sync lane reports at.
 *
 * @param root - The project root.
 * @param options - Which lane asks.
 * @param options.lane - The lane, as a failure line names it.
 * @param options.loadWithoutState - Whether a project with a config and no
 *        state file has its config loaded (jest) or reports at the built-in
 *        levels (the Turbopack loader).
 * @returns The policy, and what it was resolved from.
 */
export function syncLaneDiagnosticPolicy(
    root: string,
    options: { lane: string; loadWithoutState: boolean },
): SyncLanePolicy {
    const state = readStateFile(root);
    if (state !== null) {
        const current = currentInputs(root, state);
        if (current !== null) return { policy: diagnosticPolicyFromState(state), inputs: current };
    }
    const found = findCsszyxConfigFile(root);
    if (found === null || (state === null && !options.loadWithoutState)) {
        return { policy: createDiagnosticPolicy(), inputs: [] };
    }
    // Taken before the load, so an edit made while it runs reads as a change.
    const inputs = diagnosticPolicyInputs(root);
    return { policy: loadInChild(root, found, options.lane), inputs };
}
