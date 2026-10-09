/**
 * Loading `csszyx.config.{ts,mts,js,mjs}` and handing its policy to the lanes
 * that cannot load it.
 *
 * Node's own `import()` reads every name: Node `^22.18 || >=24.11` strips
 * TypeScript types natively, so no bundler or transpiler is involved. One case
 * needs help, measured on Node 24.18: a `.ts` or `.js` file is read as
 * CommonJS under `"type": "commonjs"`, and the config every project is told to
 * write uses `export default`, so `import()` throws "Cannot use import
 * statement outside a module". The loader then imports the same text under an
 * `.mts`/`.mjs` name written beside the original — so its relative imports and
 * packages resolve from the same place — and removes it again. Vite loads its
 * own config the same way. A project with no `"type"` at all loads natively,
 * and Node prints its `MODULE_TYPELESS_PACKAGE_JSON` advice once.
 *
 * The Turbopack loader and jest run synchronously and never import TypeScript,
 * so `csszyx next prebuild`/`watch` resolve the policy into
 * `.csszyx/diagnostic-policy.json`, the way they write `merge-table.json`, and
 * those lanes read it with {@link readDiagnosticPolicyState}.
 *
 * @module csszyx-config-file
 */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { atomicWriteFileSync } from './atomic-write.js';
import {
    createDiagnosticPolicy,
    DIAGNOSTIC_POLICY_FORMAT,
    type DiagnosticConfigProblem,
    type DiagnosticPolicy,
    type DiagnosticPolicyState,
    readCsszyxFileConfig,
} from './diagnostic-policy.js';

/** Every name the config file can have, in the order they are looked for. */
export const CSSZYX_CONFIG_FILE_NAMES = [
    'csszyx.config.ts',
    'csszyx.config.mts',
    'csszyx.config.js',
    'csszyx.config.mjs',
] as const;

/** The state file the Turbopack loader and jest read, under `.csszyx/`. */
export const DIAGNOSTIC_POLICY_STATE_FILE = 'diagnostic-policy.json';

/** The config file a project has, and any others it holds that are not read. */
export interface FoundConfigFile {
    /** Absolute path of the file that is read. */
    file: string;
    /** Names of the other config files present, which are not read. */
    ignored: string[];
}

/**
 * Find the project's config file.
 *
 * @param root - The project root.
 * @returns The file read and the ones left unread, or null when there is none.
 */
export function findCsszyxConfigFile(root: string): FoundConfigFile | null {
    const present = CSSZYX_CONFIG_FILE_NAMES.filter(name => existsSync(path.join(root, name)));
    const [first, ...ignored] = present;
    return first === undefined ? null : { file: path.join(root, first), ignored };
}

/** Imports a module by URL; Node's `import()` unless a caller substitutes one. */
export type ModuleImporter = (url: string) => Promise<unknown>;

/**
 * Node's own `import()`.
 *
 * @param url - A `file:` URL.
 * @returns The module namespace.
 */
const nativeImport: ModuleImporter = url => import(url);

/** The ES-module twin of each name that Node may read as CommonJS. */
const ESM_TWIN: Readonly<Record<string, string>> = { '.ts': '.mts', '.js': '.mjs' };

/**
 * Import a config file, retrying it as an ES module when Node read it as
 * CommonJS.
 *
 * The URL carries the file's mtime, so a config edited during a dev session
 * is read again rather than served from the module cache.
 *
 * @param file - Absolute path.
 * @param importModule - The importer.
 * @returns The module namespace.
 */
async function importConfig(file: string, importModule: ModuleImporter): Promise<unknown> {
    const url = `${pathToFileURL(file).href}?mtime=${statSync(file).mtimeMs}`;
    const twin = ESM_TWIN[path.extname(file)];
    try {
        return await importModule(url);
    } catch (error) {
        if (twin === undefined || !(error instanceof SyntaxError)) throw error;
    }
    const copy = `${file}.timestamp-${Date.now()}-${process.pid}${twin}`;
    writeFileSync(copy, readFileSync(file, 'utf8'));
    try {
        return await importModule(pathToFileURL(copy).href);
    } finally {
        rmSync(copy, { force: true });
    }
}

/** What loading a project's config produced. */
export interface LoadedDiagnosticPolicy {
    /** Absolute path of the config read, or null when the project has none. */
    file: string | null;
    /** The policy; the defaults when there is no file or it did not load. */
    policy: DiagnosticPolicy;
    /** Everything wrong with the file, `error` first in the order found. */
    problems: DiagnosticConfigProblem[];
}

/**
 * Load the project's config and build its diagnostic policy.
 *
 * Never throws: a config that does not load is an `error` problem and the
 * defaults apply, so each caller decides what a broken config costs — `check`
 * fails the run, a build prints the problem and carries on.
 *
 * @param root - The project root.
 * @param importModule - The importer; Node's `import()` by default.
 * @returns The file, the policy and the problems.
 */
export async function loadDiagnosticPolicy(
    root: string,
    importModule: ModuleImporter = nativeImport,
): Promise<LoadedDiagnosticPolicy> {
    const found = findCsszyxConfigFile(root);
    if (found === null) return { file: null, policy: createDiagnosticPolicy(), problems: [] };
    const name = path.basename(found.file);
    const problems: DiagnosticConfigProblem[] = found.ignored.map(ignored => ({
        severity: 'warning',
        path: ignored,
        message: `not read: \`${name}\` is read first. Keep one config file.`,
    }));
    let module: unknown;
    try {
        module = await importConfig(found.file, importModule);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        problems.unshift({
            severity: 'error',
            path: name,
            message: `could not be loaded, so every diagnostic keeps its default level: ${reason.split('\n')[0]}`,
        });
        return { file: found.file, policy: createDiagnosticPolicy(), problems };
    }
    const read = readCsszyxFileConfig((module as { default?: unknown }).default);
    return {
        file: found.file,
        policy: createDiagnosticPolicy(read.config),
        problems: [...read.problems, ...problems],
    };
}

/**
 * Where the policy state file lives for a project.
 *
 * @param root - The project root.
 * @returns Absolute path.
 */
export function diagnosticPolicyStatePath(root: string): string {
    return path.join(root, '.csszyx', DIAGNOSTIC_POLICY_STATE_FILE);
}

/**
 * Write the policy for the lanes that cannot load the config, when it changed.
 *
 * Unchanged content is not rewritten: Turbopack re-runs every module that
 * depends on the file when it changes.
 *
 * @param root - The project root.
 * @param policy - The resolved policy.
 * @returns Whether the file was written.
 */
export function writeDiagnosticPolicyState(root: string, policy: DiagnosticPolicy): boolean {
    const target = diagnosticPolicyStatePath(root);
    const text = `${JSON.stringify(policy.toJSON())}\n`;
    if (existsSync(target) && readFileSync(target, 'utf8') === text) return false;
    atomicWriteFileSync(target, text);
    return true;
}

/**
 * Read the policy a Next command wrote.
 *
 * A missing, unreadable or other-format file gives the defaults: the policy
 * only decides how loudly something is said, never what is built.
 *
 * @param root - The project root.
 * @returns The policy.
 */
export function readDiagnosticPolicyState(root: string): DiagnosticPolicy {
    let state: Partial<DiagnosticPolicyState>;
    try {
        state = JSON.parse(readFileSync(diagnosticPolicyStatePath(root), 'utf8'));
    } catch {
        return createDiagnosticPolicy();
    }
    if (state.format !== DIAGNOSTIC_POLICY_FORMAT) return createDiagnosticPolicy();
    return createDiagnosticPolicy(readCsszyxFileConfig({ diagnostics: state.config }).config);
}
