/**
 * The files a `csszyx.config` load reads, recorded with the policy in
 * `.csszyx/diagnostic-policy.json`.
 *
 * Jest and the Turbopack loader read the policy a Next command resolved
 * instead of loading the config. Judging that record by the config file's
 * time alone kept old levels after an edit to a module the config imports
 * (`import levels from './csszyx.levels.ts'`), so the record lists every file
 * the load reads, with its time and size, and a lane trusts it only while all
 * of them are as recorded.
 *
 * The list is read statically: the config's text and, transitively, the text
 * of every relative module it imports. Node resolves a relative ES import
 * exactly as written, so finding the specifiers is the whole job; a specifier
 * that a comment or a string holds only adds a file, which costs a needless
 * reload, never a stale level. A package (`csszyx`, a shared preset) is not
 * followed: it changes with an install, and the lockfile is not the config.
 * One pass over each file, at most {@link MAX_INPUTS} files.
 *
 * A relative import that names no file yet is recorded too, as missing, under
 * every name it could resolve to: creating the file, or deleting one the
 * config imported, is then a change like an edit. A computed specifier
 * (`import('./' + name)`) cannot be read without running the config, and is
 * not followed; the docs say so.
 *
 * @module
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { csszyxConfigFilePaths, findCsszyxConfigFile } from './csszyx-config-file.js';
import { projectRelative, samePath } from './path-case.js';

/** One file a config load read, as it stood when the policy was resolved. */
export interface DiagnosticPolicyInput {
    /** Path relative to the project root, `/`-separated. */
    file: string;
    /** Its modification time. */
    mtimeMs: number;
    /** Its size in bytes. */
    size: number;
    /**
     * Set for a name an import could resolve to where no file is: creating
     * one is a change. Its time and size are then 0.
     */
    missing?: true;
}

/** Extensions of the modules whose imports are read. */
const SCRIPT_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];

/**
 * What a specifier is tried with, in order: as written, with an extension,
 * then as a folder's index. Node's ESM loader needs the extension; a
 * CommonJS `require` and a TypeScript-aware loader do not.
 */
const RESOLVE_SUFFIXES = [
    '',
    ...SCRIPT_EXTENSIONS,
    '.json',
    ...SCRIPT_EXTENSIONS.map(extension => `/index${extension}`),
];

/**
 * A quoted specifier after `from`, `import` or `require`, an opening paren
 * allowed between. Linear: each optional part is anchored by a literal.
 */
const SPECIFIER_RE = /\b(?:from|import|require)\s*(?:\(\s*)?(['"])([^'"\r\n]+)\1/g;

/** How many files a config's import graph may hold before the scan stops. */
const MAX_INPUTS = 256;

/**
 * Whether a path names a file.
 *
 * @param file - Absolute path.
 * @returns True for a file, following links.
 */
function isFile(file: string): boolean {
    return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

/** Extensions a specifier can be written with that name the file as written. */
const WRITTEN_EXTENSIONS = new Set([...SCRIPT_EXTENSIONS, '.json']);

/** Where a specifier leads: the file it names, or the names it could have. */
type Resolved = { file: string } | { candidates: string[] };

/**
 * The file a relative or absolute specifier names.
 *
 * @param importer - The importing module.
 * @param specifier - The target as written.
 * @returns The file; the names it could resolve to when none is there; null
 *          for a package or a URL.
 */
function resolveSpecifier(importer: string, specifier: string): Resolved | null {
    if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) return null;
    const query = specifier.search(/[?#]/);
    const written = query === -1 ? specifier : specifier.slice(0, query);
    const target = path.resolve(path.dirname(importer), written);
    for (const suffix of RESOLVE_SUFFIXES) {
        if (isFile(target + suffix)) return { file: target + suffix };
    }
    // Written with its extension, it is that file; otherwise any of the names
    // the lookup tries can appear.
    if (WRITTEN_EXTENSIONS.has(path.extname(written))) return { candidates: [target] };
    return { candidates: RESOLVE_SUFFIXES.map(suffix => target + suffix) };
}

/**
 * The relative modules one file imports.
 *
 * @param file - A module.
 * @returns Where its specifiers lead, in the order written; nothing for a
 *          file that is not a script or cannot be read.
 */
function importsOf(file: string): Resolved[] {
    if (!SCRIPT_EXTENSIONS.includes(path.extname(file))) return [];
    let text: string;
    try {
        text = readFileSync(file, 'utf8');
    } catch {
        return [];
    }
    const found: Resolved[] = [];
    for (const match of text.matchAll(SPECIFIER_RE)) {
        const target = resolveSpecifier(file, match[2] as string);
        if (target !== null) found.push(target);
    }
    return found;
}

/** A config's import graph: the files it reads, and the names no file has yet. */
interface ImportGraph {
    /** Absolute paths, the config first, each once. */
    files: string[];
    /** Absolute paths an import could resolve to, where nothing is. */
    missing: string[];
}

/**
 * Walk a config's imports, transitively, in the order first met.
 *
 * @param configFile - The config file, absolute.
 * @returns The files and the missing names, at most {@link MAX_INPUTS} in all.
 */
function walkImportGraph(configFile: string): ImportGraph {
    const files = [configFile];
    const missing: string[] = [];
    const seen = new Set(files);
    const record = (into: string[], names: readonly string[]): void => {
        for (const name of names) {
            if (seen.has(name) || files.length + missing.length >= MAX_INPUTS) continue;
            seen.add(name);
            into.push(name);
        }
    };
    // The list grows while it is read: an imported module is read in turn.
    for (const file of files) {
        for (const target of importsOf(file)) {
            if ('file' in target) record(files, [target.file]);
            else record(missing, target.candidates);
        }
    }
    return { files, missing };
}

/**
 * Every file a config load reads: the config, then each relative module it
 * imports, transitively, in the order first met.
 *
 * @param configFile - The config file, absolute.
 * @returns Absolute paths, the config first, each once.
 */
export function configImportGraph(configFile: string): string[] {
    return walkImportGraph(configFile).files;
}

/**
 * The files a load of the project's config reads, as they stand now. Taken
 * before the load, so an edit made while it runs reads as a change.
 *
 * @param root - The project root.
 * @returns The inputs, the config first; none when the project has no config.
 */
export function diagnosticPolicyInputs(root: string): DiagnosticPolicyInput[] {
    const found = findCsszyxConfigFile(root);
    if (found === null) return [];
    const { files, missing } = walkImportGraph(found.file);
    const absent = (file: string): DiagnosticPolicyInput => ({
        file: projectRelative(root, file),
        mtimeMs: 0,
        size: 0,
        missing: true,
    });
    return [
        ...files.map(file => {
            const stat = statSync(file, { throwIfNoEntry: false });
            // Gone between the walk and here: missing, as it now is.
            return stat === undefined
                ? absent(file)
                : { file: projectRelative(root, file), mtimeMs: stat.mtimeMs, size: stat.size };
        }),
        ...missing.map(absent),
    ];
}

/**
 * Whether every recorded input still has its recorded time and size.
 *
 * One `stat` per input, no read: the lanes ask this before each use of the
 * record.
 *
 * @param root - The project root.
 * @param inputs - The inputs a record lists.
 * @returns False once any of them is edited, replaced or gone, or a missing
 *          one is created.
 */
export function diagnosticPolicyInputsUnchanged(
    root: string,
    inputs: readonly DiagnosticPolicyInput[],
): boolean {
    return inputs.every(input => {
        const stat = statSync(path.resolve(root, input.file), { throwIfNoEntry: false });
        if (input.missing === true) return stat === undefined;
        return stat?.mtimeMs === input.mtimeMs && stat.size === input.size;
    });
}

/**
 * Whether a policy resolved from these inputs is still the project's: the
 * config it was read from is the one the project has now (or there was none
 * and still is none), and every input is unchanged.
 *
 * One `stat` per input and one per config name the project could have, no
 * read; a watch lane asks this at the start of each rebuild.
 *
 * @param root - The project root.
 * @param inputs - What {@link diagnosticPolicyInputs} returned before the load.
 * @returns False once the config is created, deleted or replaced by another
 *          name, or any input is edited, replaced or gone.
 */
export function diagnosticPolicyInputsCurrent(
    root: string,
    inputs: readonly DiagnosticPolicyInput[],
): boolean {
    const found = findCsszyxConfigFile(root);
    const config = found === null ? undefined : projectRelative(root, found.file);
    return inputs[0]?.file === config && diagnosticPolicyInputsUnchanged(root, inputs);
}

/**
 * The files a session watches to see its policy go out of date: every name
 * the config can have, so creating or deleting one counts, and every other
 * input.
 *
 * @param root - The project root.
 * @param inputs - The inputs the policy was resolved from.
 * @returns Absolute paths, each once.
 */
export function diagnosticPolicyWatchFiles(
    root: string,
    inputs: readonly DiagnosticPolicyInput[],
): string[] {
    return [
        ...new Set([
            ...csszyxConfigFilePaths(root),
            ...inputs.map(input => path.resolve(root, input.file)),
        ]),
    ];
}

/**
 * Whether a path a watcher reported is one the policy goes out of date with
 * ({@link diagnosticPolicyWatchFiles}), compared by the rule of the file
 * system the project lives on.
 *
 * @param root - The project root.
 * @param inputs - The inputs the policy was resolved from.
 * @param file - The reported path.
 * @returns True for a config name or any input, in any spelling of it the
 *          file system reads as the same file.
 */
export function isDiagnosticPolicyWatchFile(
    root: string,
    inputs: readonly DiagnosticPolicyInput[],
    file: string,
): boolean {
    return diagnosticPolicyWatchFiles(root, inputs).some(watched => samePath(root, watched, file));
}
