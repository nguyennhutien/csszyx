/**
 * The Tailwind prefix, read ahead of time for the Next Turbopack lane.
 *
 * A Turbopack loader runs synchronously, one module at a time, and reading the
 * prefix means compiling the project's stylesheets, which is asynchronous. So
 * `csszyx next prebuild` and `csszyx next watch` read them with the same style
 * model every other lane opens, and write down what they settled. The loader
 * reads the file.
 *
 * The file records the project it was written for, every stylesheet it looked
 * at, the content hash of every stylesheet it read, and of every `.gitignore`
 * its walk applied, so a reader can tell when it describes another project, or
 * a project that has since gained a stylesheet, changed one, or changed which
 * ones git ignores, instead of lowering against a prefix the project no longer
 * sets.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import {
    closeSync,
    existsSync,
    fstatSync,
    openSync,
    readFileSync,
    realpathSync,
    statSync,
} from 'node:fs';
import path from 'node:path';

import type { StylesheetFacts } from '@csszyx/tailwind-oracle';

import { type AtomicWriteOptions, atomicWriteFileSync } from './atomic-write.js';
import { stylesheetsImportedBy } from './js-stylesheet-imports.js';
import { resolveNextAppCacheDir, resolveNextAppRoot } from './next-root-resolver.js';
import {
    mayReachTailwind,
    missingTailwindStylesheetMessage,
    openProjectStyleModel,
    originWarning,
    type ProjectStyleModel,
    styleModelError,
    styleModelWarning,
} from './project-style-model.js';
import { createRootIgnoreMatcher } from './root-ignore-matcher.js';
import { sortStrings } from './sort.js';
import { collectSpecifierAliases } from './specifier-aliases.js';
import { discoverProjectTheme } from './theme-discovery.js';

/** One stylesheet the facts were read from, with the content they were read against. */
export interface NextStylesheetFactsEntry {
    file: string;
    sha256: string;
    /**
     * Whether an edit to it can change the facts, so a loader re-runs on one.
     * False for a stylesheet that cannot reach Tailwind, such as a CSS module:
     * the facts still go stale when it changes, but no module has to recompile.
     */
    dependency: boolean;
}

/** One `.gitignore` the stylesheet walk applied, with the content it applied. */
export interface NextGitignoreEntry {
    file: string;
    /** Hex sha256 of its content, or `missing` when it could not be read. */
    sha256: string;
}

/** The schema this csszyx writes and reads. */
const FACTS_SCHEMA = 4;

/** What `csszyx next prebuild` and `next watch` record for the loader. */
export interface NextStylesheetFactsRecord {
    schema: 4;
    /** The app root the stylesheets were read from. */
    root: string;
    /**
     * The patterns the command was told to ignore, relative to the root. A
     * reader walks the project itself and leaves the same paths out, or it
     * would find a stylesheet the record was not written with and refuse it.
     */
    ignore: string[];
    /** What the stylesheets settled, or null when none reaches Tailwind. */
    facts: StylesheetFacts | null;
    /** Every stylesheet looked at, so a reader can tell when one was added. */
    candidates: string[];
    /** Every stylesheet read, and every one they import, so a reader can tell when one changed. */
    entries: NextStylesheetFactsEntry[];
    /**
     * Every `.gitignore` the stylesheet walk applied, parents first. The walk
     * skips what they cover, so an edit to one can add or drop a candidate.
     */
    gitignore: NextGitignoreEntry[];
}

/** The facts file's name, under the Next app's csszyx cache directory. */
export const NEXT_STYLESHEET_FACTS_FILE = 'stylesheet-facts.json';

/**
 * Where the facts file for an app lives.
 *
 * @param cacheDir - The csszyx cache directory for the app.
 * @returns Absolute path of the facts file.
 */
export function resolveNextStylesheetFactsPath(cacheDir: string): string {
    return path.join(cacheDir, NEXT_STYLESHEET_FACTS_FILE);
}

/**
 * Hash every input that can change a failed synchronous prefix resolution.
 *
 * This is intended for error memoization. For `C` candidate stylesheets
 * containing `B` bytes it costs `O(C log C + B)` time and `O(C)` space. The
 * worst case is a project with many large candidate stylesheets; canonical
 * path order makes the same filesystem state produce the same stamp in every
 * lane that needs to retry after an edit.
 *
 * @param input - The project and stylesheet selection whose failure is cached.
 * @param input.root - The project root.
 * @param input.cacheDir - The directory containing recorded stylesheet facts.
 * @param input.tailwindStylesheet - Explicit stylesheet paths, when configured.
 * @param input.ignore - The caller's own ignore patterns; the recorded ones
 *        when it has none.
 * @returns A deterministic content hash of the facts file and candidates.
 */
export function failedNextClassPrefixInputsStamp(input: {
    root: string;
    cacheDir: string;
    tailwindStylesheet: readonly string[];
    ignore?: readonly string[];
}): string {
    const walked =
        input.tailwindStylesheet.length > 0
            ? {
                  files: input.tailwindStylesheet.map(file => path.resolve(input.root, file)),
                  gitignoreFiles: [],
              }
            : walkStylesheets(
                  input.root,
                  input.ignore ?? recordedIgnore(input.cacheDir, input.root),
              );
    const files = sortStrings([
        resolveNextStylesheetFactsPath(input.cacheDir),
        ...walked.files,
        ...walked.gitignoreFiles,
    ]);
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(file).update('\0');
        try {
            hash.update(readFileSync(file));
        } catch {
            hash.update('\0missing');
        }
        hash.update('\0');
    }
    return hash.digest('hex');
}

/**
 * A file's content hash.
 *
 * @param content - File content.
 * @returns Hex sha256.
 */
function sha256Of(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * How long a file's timestamp has to be in the past before its hash is reused.
 *
 * A filesystem stamps a write with a coarse time, so two writes close together
 * can leave the same size and time on different content. Past this window
 * the size and time identify the content, and a loader that asks once per
 * module stops re-reading every stylesheet.
 */
const HASH_SETTLE_MS = 2_000;

/** Hashes already computed, with the size and time they were computed at. */
const hashes = new Map<string, { mtimeMs: number; size: number; sha256: string }>();

/**
 * A file's content hash as it is now, or null when it cannot be read.
 *
 * The size and time are taken from the descriptor the content is read
 * through, so a file replaced between the two cannot leave its new content
 * memoised under the old stamp.
 *
 * @param file - Absolute path.
 * @returns Hex sha256, or null.
 */
function currentSha256(file: string): string | null {
    let fd: number | undefined;
    try {
        fd = openSync(file, 'r');
        const { mtimeMs, size } = fstatSync(fd);
        const known = hashes.get(file);
        if (
            known?.mtimeMs === mtimeMs &&
            known.size === size &&
            Date.now() - mtimeMs > HASH_SETTLE_MS
        ) {
            return known.sha256;
        }
        const sha256 = sha256Of(readFileSync(fd, 'utf8'));
        hashes.set(file, { mtimeMs, size, sha256 });
        return sha256;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

/**
 * A stylesheet's path as a message names it.
 *
 * @param root - The project root.
 * @param file - Absolute path.
 * @returns The path relative to the root, with forward slashes.
 */
function displayName(root: string, file: string): string {
    return path.relative(root, file).split(path.sep).join('/');
}

/** A stylesheet that ships inside the Tailwind package, which a project does not edit. */
const TAILWIND_PACKAGE_FILE = /[\\/]node_modules[\\/]tailwindcss[\\/]/;

/**
 * Whether a parsed file holds a facts record this csszyx reads.
 *
 * @param value - The parsed file.
 * @returns True for a record of the current shape.
 */
function isFactsRecord(value: unknown): value is NextStylesheetFactsRecord {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Partial<Record<keyof NextStylesheetFactsRecord, unknown>>;
    return (
        record.schema === FACTS_SCHEMA &&
        Array.isArray(record.gitignore) &&
        record.gitignore.every(
            entry => typeof entry?.file === 'string' && typeof entry.sha256 === 'string',
        ) &&
        typeof record.root === 'string' &&
        Array.isArray(record.ignore) &&
        record.ignore.every(pattern => typeof pattern === 'string') &&
        Array.isArray(record.candidates) &&
        record.candidates.every(file => typeof file === 'string') &&
        Array.isArray(record.entries) &&
        record.entries.every(
            entry =>
                typeof entry?.file === 'string' &&
                typeof entry.sha256 === 'string' &&
                typeof entry.dependency === 'boolean',
        )
    );
}

/**
 * The facts file as it lies on disk, whatever it describes.
 *
 * @param cacheDir - The csszyx cache directory for the app.
 * @returns The record, or why it cannot be used.
 */
function readFactsRecord(
    cacheDir: string,
): { ok: true; record: NextStylesheetFactsRecord } | { ok: false; reason: string } {
    const text = readText(resolveNextStylesheetFactsPath(cacheDir));
    if (text === null) return { ok: false, reason: 'no stylesheet facts have been written yet' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'the stylesheet facts file is not valid JSON' };
    }
    const schema = (parsed as { schema?: unknown } | null)?.schema;
    if (typeof schema === 'number' && schema < FACTS_SCHEMA) {
        return {
            ok: false,
            reason: 'the stylesheet facts were written by an older csszyx, before they recorded which files `.gitignore` leaves out; run `csszyx next prebuild` again to rewrite them',
        };
    }
    if (!isFactsRecord(parsed)) {
        return {
            ok: false,
            reason: 'the stylesheet facts file has a shape this csszyx does not read',
        };
    }
    return { ok: true, record: parsed };
}

/**
 * A file's text, or null when it cannot be read.
 *
 * @param file - Absolute path.
 * @returns The text, or null.
 */
function readText(file: string): string | null {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return null;
    }
}

/**
 * Open the project's style model from the stylesheets a Next command reads,
 * writing nothing.
 *
 * Stops, exactly as a bundler build does, when the stylesheets give no single
 * prefix or one that reaches Tailwind does not compile.
 *
 * @param input - Where the app is and which stylesheets it loads.
 * @param input.root - The Next app root.
 * @param input.cacheDir - The csszyx cache directory for that app, read for
 *        the stylesheets and patterns an earlier command recorded.
 * @param input.tailwindStylesheet - The stylesheets the app loads, when named.
 * @param input.extraCandidates - Stylesheets the walk cannot find.
 * @param input.ignore - Glob patterns whose stylesheets are left out of the
 *        walk; the recorded ones when not given.
 * @param input.setting - What messages call the setting that names the stylesheets.
 * @param input.ignoreSetting - What messages call the setting that carries `ignore`.
 * @returns The model, the stylesheets it compiled, and the patterns applied.
 */
export async function openStylesheetModel(input: {
    root: string;
    cacheDir: string;
    tailwindStylesheet?: readonly string[];
    extraCandidates?: readonly string[];
    ignore?: readonly string[];
    setting?: string;
    ignoreSetting?: string;
}): Promise<{
    model: ProjectStyleModel;
    candidates: string[];
    ignore: string[];
    gitignoreFiles: string[];
}> {
    const listed = (input.tailwindStylesheet ?? []).map(file => ({
        file,
        absolute: path.resolve(input.root, file),
    }));
    const missing = listed.filter(entry => !existsSync(entry.absolute)).map(entry => entry.file);
    if (missing.length > 0) {
        throw new Error(missingTailwindStylesheetMessage(missing, input.root, input.setting));
    }
    // A writer with no patterns of its own, such as the jest lane, keeps the
    // ones the command recorded: writing none would bring the ignored entries
    // back into the vote on the next read.
    const ignore = canonicalIgnore(input.ignore ?? recordedIgnore(input.cacheDir, input.root));
    const { ignoresFile } = createRootIgnoreMatcher(input.root, ignore);
    // A bundler build reaches stylesheets through JavaScript imports that a
    // walk cannot see. The ones it recorded are kept while they exist, or this
    // writer would drop them and record the prefix they set as none. A
    // stylesheet this run's sources import stays even under an ignored path:
    // the import is evidence the app loads it.
    const walk = walkStylesheets(input.root, ignore);
    const walked = [
        ...new Set([
            ...walk.files,
            ...(input.extraCandidates ?? []),
            ...recordedCandidates(input.cacheDir, input.root).filter(file => !ignoresFile(file)),
        ]),
    ];
    const candidates = listed.length > 0 ? listed.map(entry => entry.absolute) : walked;
    const model = await openProjectStyleModel(input.root, candidates, {
        aliases: collectSpecifierAliases(input.root),
        // A named list decides the prefix; a stylesheet a page imports still
        // selects on its elements.
        hookStylesheets: listed.length > 0 ? walked : [],
    });
    const problem = styleModelError(model, input.root, input.setting, input.ignoreSetting);
    if (problem !== null) throw new Error(problem);

    return { model, candidates, ignore, gitignoreFiles: walk.gitignoreFiles };
}

/**
 * Read the project's stylesheets and record what they settled.
 *
 * Stops, exactly as a bundler build does, when the stylesheets give no single
 * prefix or one that reaches Tailwind does not compile.
 *
 * @param input - Where the app is and which stylesheets it loads.
 * @param input.root - The Next app root.
 * @param input.cacheDir - The csszyx cache directory for that app.
 * @param input.tailwindStylesheet - The stylesheets the app loads, when named.
 * @param input.extraCandidates - Stylesheets the walk cannot find, such as one
 *        a source file imports from a package.
 * @param input.ignore - Glob patterns, relative to the root, whose stylesheets
 *        are left out of the walk; the recorded ones when not given.
 * @param input.setting - What messages call the setting that names the stylesheets.
 * @param input.ignoreSetting - What messages call the setting that carries
 *        `ignore`, on a lane that has one.
 * @param input.writeOptions - Atomic write options.
 * @returns The record, where it lives, and any warning to print.
 */
export async function writeNextStylesheetFacts(input: {
    root: string;
    cacheDir: string;
    tailwindStylesheet?: readonly string[];
    extraCandidates?: readonly string[];
    ignore?: readonly string[];
    setting?: string;
    ignoreSetting?: string;
    writeOptions?: AtomicWriteOptions;
}): Promise<{
    record: NextStylesheetFactsRecord;
    path: string;
    warning: string | null;
    model: ProjectStyleModel;
}> {
    const { model, candidates, ignore, gitignoreFiles } = await openStylesheetModel(input);
    const { record, path: file } = recordStylesheetFacts(
        model,
        input.root,
        input.cacheDir,
        candidates,
        {
            writeOptions: input.writeOptions,
            ignore,
            gitignoreFiles,
        },
    );
    return {
        record,
        path: file,
        warning:
            [styleModelWarning(model, input.root, input.setting), originWarning(model, input.root)]
                .filter(message => message !== null)
                .join('\n') || null,
        model,
    };
}

/**
 * An ignore list in the one form it is recorded and compared in.
 *
 * Negated patterns are refused, so every pattern only adds paths and the order
 * they were given in means nothing. Recorded as given, `a,b` and `b,a` would
 * read as two configurations and each reader would refuse the other's facts.
 *
 * @param ignore - The patterns as a caller gave them.
 * @returns The distinct patterns, sorted.
 */
function canonicalIgnore(ignore: readonly string[]): string[] {
    return sortStrings(new Set(ignore));
}

/**
 * The ignore patterns an earlier write for this project recorded.
 *
 * They describe the command, not the stylesheets, so a record whose
 * stylesheets have since changed still answers.
 *
 * @param cacheDir - The csszyx cache directory for the app.
 * @param root - The Next app root.
 * @returns The patterns; empty when no record for this root is there.
 */
function recordedIgnore(cacheDir: string, root: string): string[] {
    const read = readFactsRecord(cacheDir);
    if (!read.ok || path.resolve(read.record.root) !== path.resolve(root)) return [];
    return read.record.ignore;
}

/**
 * The stylesheets a walk of the project finds outside the ignored paths and
 * what `.gitignore` covers, and the `.gitignore` files it applied.
 *
 * @param root - The Next app root.
 * @param ignore - Patterns to leave out, relative to the root.
 * @returns Absolute stylesheet paths, and absolute `.gitignore` paths.
 */
function walkStylesheets(
    root: string,
    ignore: readonly string[],
): { files: string[]; gitignoreFiles: string[] } {
    const { scanned, gitignoreFiles } = discoverProjectTheme(root, [], ignore);
    return { files: scanned, gitignoreFiles };
}

/**
 * The fingerprint of the `.gitignore` files a walk applied.
 *
 * @param files - Their paths, in the order the walk applied them.
 * @returns One entry per file, with its content hash.
 */
function gitignoreFingerprint(files: readonly string[]): NextGitignoreEntry[] {
    return files.map(file => ({ file, sha256: currentSha256(file) ?? 'missing' }));
}

/**
 * Whether two `.gitignore` fingerprints describe the same files and content.
 *
 * @param a - One fingerprint.
 * @param b - The other.
 * @returns True when equal, entry for entry.
 */
function sameGitignore(
    a: readonly NextGitignoreEntry[],
    b: readonly NextGitignoreEntry[],
): boolean {
    return (
        a.length === b.length &&
        a.every(
            (entry, index) => entry.file === b[index]?.file && entry.sha256 === b[index]?.sha256,
        )
    );
}

/**
 * The `.gitignore` files a record lists, hashed as they are now.
 *
 * @param cacheDir - The csszyx cache directory for the app.
 * @returns Their fingerprint, or undefined when no record can be read.
 */
function recordedGitignoreNow(cacheDir: string): NextGitignoreEntry[] | undefined {
    const read = readFactsRecord(cacheDir);
    return read.ok
        ? gitignoreFingerprint(read.record.gitignore.map(entry => entry.file))
        : undefined;
}

/**
 * The stylesheets an earlier write for this project looked at that still exist.
 *
 * @param cacheDir - The csszyx cache directory for the app.
 * @param root - The Next app root.
 * @returns Their paths; empty when no record for this root is there.
 */
function recordedCandidates(cacheDir: string, root: string): string[] {
    const read = readFactsRecord(cacheDir);
    if (!read.ok || path.resolve(read.record.root) !== path.resolve(root)) return [];
    return read.record.candidates.filter(file => existsSync(file));
}

/**
 * Write what an opened style model settled, for the lanes that cannot open one.
 *
 * A bundler build has the model in hand already; a Turbopack loader and a jest
 * transformer run synchronously and read this file instead of compiling the
 * stylesheets themselves.
 *
 * @param model - The opened style model.
 * @param root - The project root the stylesheets were read from.
 * @param cacheDir - The csszyx cache directory for that project.
 * @param candidates - Every stylesheet the model was opened over.
 * @param options - How the record is written.
 * @param options.writeOptions - Atomic write options.
 * @param options.ignore - The patterns the writer walked with; the ones already
 *        recorded for this project when the writer has none of its own.
 * @param options.gitignoreFiles - The `.gitignore` files the walk behind
 *        `candidates` applied. Every writer has walked already; a second walk
 *        here could apply other files than the one that found the candidates.
 * @returns The record and where it lives.
 */
export function recordStylesheetFacts(
    model: ProjectStyleModel,
    root: string,
    cacheDir: string,
    candidates: readonly string[],
    options: {
        writeOptions?: AtomicWriteOptions;
        ignore?: readonly string[];
        gitignoreFiles: readonly string[];
    },
): { record: NextStylesheetFactsRecord; path: string } {
    const ignore = canonicalIgnore(options.ignore ?? recordedIgnore(cacheDir, root));
    const entries = model.entries.map(entry => {
        const text = readFileSync(entry.file, 'utf8');
        return {
            file: entry.file,
            sha256: sha256Of(text),
            dependency: entry.role !== 'not-root' || mayReachTailwind(text),
        };
    });
    // A stylesheet a root imports can set the prefix itself, so an edit to it
    // is an edit to the facts. Tailwind's own stylesheets are not the project's.
    // Every entry was read a moment ago, so each resolves.
    const read = new Set(entries.map(entry => realpathSync(entry.file)));
    for (const file of model.imports) {
        if (read.has(file) || TAILWIND_PACKAGE_FILE.test(file)) continue;
        read.add(file);
        entries.push({ file, sha256: sha256Of(readFileSync(file, 'utf8')), dependency: true });
    }
    const record: NextStylesheetFactsRecord = {
        schema: FACTS_SCHEMA,
        root,
        ignore,
        facts: model.facts,
        candidates: [...candidates],
        entries,
        gitignore: gitignoreFingerprint(options.gitignoreFiles),
    };
    const file = resolveNextStylesheetFactsPath(cacheDir);
    const content = `${JSON.stringify(record, null, 2)}\n`;
    // Rewritten only when it changed: a loader declares this file as a
    // dependency, so identical bytes written again would recompile every module.
    if (readText(file) !== content) atomicWriteFileSync(file, content, options.writeOptions);
    return { record, path: file };
}

/**
 * Read the facts a prebuild recorded, and whether they still describe the stylesheets.
 *
 * @param cacheDir - The csszyx cache directory for the app.
 * @param expected - The project the reader is in, and the stylesheets it can
 *        see; facts written for another root, or without one of these, are stale.
 * @param expected.root - The reader's project root.
 * @param expected.candidates - The stylesheets the reader would read.
 * @param expected.ignore - The reader's own ignore patterns, when it was
 *        configured with them; facts written under other patterns are stale.
 * @param expected.gitignore - The `.gitignore` files the reader's own walk
 *        applied, when its candidates come from a walk; facts written under
 *        other ones are stale.
 * @returns The record, or why it cannot be used.
 */
export function readNextStylesheetFacts(
    cacheDir: string,
    expected?: {
        root: string;
        candidates: readonly string[];
        ignore?: readonly string[];
        gitignore?: readonly NextGitignoreEntry[];
    },
): { ok: true; record: NextStylesheetFactsRecord } | { ok: false; reason: string } {
    const read = readFactsRecord(cacheDir);
    if (!read.ok) return read;
    const { record } = read;
    if (expected !== undefined) {
        if (path.resolve(record.root) !== path.resolve(expected.root)) {
            return {
                ok: false,
                reason: `the stylesheet facts were written for ${record.root}, not this project`,
            };
        }
        if (
            expected.ignore !== undefined &&
            canonicalIgnore(expected.ignore).join('\0') !==
                canonicalIgnore(record.ignore).join('\0')
        ) {
            return {
                ok: false,
                reason: 'the stylesheet facts were written under other ignore patterns',
            };
        }
        if (
            expected.gitignore !== undefined &&
            !sameGitignore(expected.gitignore, record.gitignore)
        ) {
            return {
                ok: false,
                reason: 'a .gitignore changed since the stylesheet facts were written',
            };
        }
        const recorded = new Set(record.candidates);
        const added = expected.candidates.find(file => !recorded.has(file));
        if (added !== undefined) {
            return {
                ok: false,
                reason: `${displayName(record.root, added)} appeared since the stylesheet facts were written`,
            };
        }
    }
    for (const entry of record.entries) {
        if (currentSha256(entry.file) !== entry.sha256) {
            return {
                ok: false,
                reason: `${displayName(record.root, entry.file)} changed since the stylesheet facts were written`,
            };
        }
    }
    return { ok: true, record };
}

/** The walk each root was last given, and the facts file it was taken against. */
const walkedCandidates = new Map<string, StylesheetWalk & { stamp: string | null }>();

/** What one walk of a project found, and the patterns it was found under. */
interface StylesheetWalk {
    files: string[];
    ignore: string[];
    gitignore: NextGitignoreEntry[];
}

/**
 * The stylesheets a walk of the project finds, walked again only when the
 * facts file changes.
 *
 * A loader asks once per module, and a walk per module is a directory scan per
 * module. `csszyx next watch` rewrites the facts file when a stylesheet
 * appears, which is the moment a fresh walk can find something new.
 *
 * @param root - The Next app root.
 * @param cacheDir - The csszyx cache directory for that app.
 * @returns Absolute stylesheet paths.
 */
export function projectStylesheetCandidates(root: string, cacheDir: string): string[] {
    return projectStylesheetWalk(root, cacheDir).files;
}

/**
 * The ignore patterns recorded for a project, read again only when the facts
 * file changes.
 *
 * @param root - The Next app root.
 * @param cacheDir - The csszyx cache directory for that app.
 * @returns The patterns; empty when no record for this root is there.
 */
export function recordedStylesheetIgnore(root: string, cacheDir: string): string[] {
    return projectStylesheetWalk(root, cacheDir).ignore;
}

/**
 * The `.gitignore` files the last walk of a project applied, with their
 * content, walked again when the facts file or one of them changes.
 *
 * @param root - The Next app root.
 * @param cacheDir - The csszyx cache directory for that app.
 * @returns The fingerprint a reader compares with the recorded one.
 */
export function projectStylesheetGitignore(root: string, cacheDir: string): NextGitignoreEntry[] {
    return projectStylesheetWalk(root, cacheDir).gitignore;
}

/**
 * A file's identity on disk, for noticing an edit without reading it.
 *
 * @param file - Absolute path.
 * @returns Inode, time and size, or null when it is not there.
 */
function statStamp(file: string): string | null {
    try {
        const stat = statSync(file);
        return `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
    } catch {
        return null;
    }
}

/**
 * The walk a root was last given, taken again only when the facts file or a
 * `.gitignore` that walk applied changes.
 *
 * @param root - The Next app root.
 * @param cacheDir - The csszyx cache directory for that app.
 * @returns The stylesheets found and the patterns they were found under.
 */
function projectStylesheetWalk(root: string, cacheDir: string): StylesheetWalk {
    const factsStamp = statStamp(resolveNextStylesheetFactsPath(cacheDir));
    const walked = walkedCandidates.get(root);
    if (walked !== undefined) {
        const stamp = [factsStamp, ...walked.gitignore.map(entry => statStamp(entry.file))].join(
            '|',
        );
        if (walked.stamp === stamp) return walked;
    }
    const ignore = recordedIgnore(cacheDir, root);
    const { files, gitignoreFiles } = walkStylesheets(root, ignore);
    const gitignore = gitignoreFingerprint(gitignoreFiles);
    const stamp = [factsStamp, ...gitignoreFiles.map(statStamp)].join('|');
    const entry = { stamp, files, ignore, gitignore };
    walkedCandidates.set(root, entry);
    return entry;
}

/** The prefix a Next lane lowers with, and the files that decided it. */
export type NextClassPrefix =
    | { ok: true; prefix: string | null; dependencies: string[] }
    | { ok: false; reason: string };

/**
 * The prefix a synchronous Next lane lowers with.
 *
 * Fresh facts answer it. A project none of whose stylesheets could reach
 * Tailwind has no prefix, which needs no compile and so no facts file. Every
 * other case has to wait for the stylesheets to be read.
 *
 * @param input - Where the app is and which stylesheets it loads.
 * @param input.root - The Next app root.
 * @param input.cacheDir - The csszyx cache directory for that app.
 * @param input.tailwindStylesheet - The stylesheets the app loads; empty when not named.
 * @param input.candidates - The stylesheets a walk found, when the caller has
 *        walked already; the project is walked when neither these nor
 *        `tailwindStylesheet` are given.
 * @param input.ignore - The caller's own ignore patterns, for a lane
 *        configured with them; the recorded ones otherwise.
 * @param input.gitignore - The `.gitignore` files the walk behind
 *        `candidates` applied; the recorded files, read now, when a caller
 *        hands candidates without them.
 * @returns The prefix and its dependencies, or why it is not known yet.
 */
export function resolveNextClassPrefix(input: {
    root: string;
    cacheDir: string;
    tailwindStylesheet: readonly string[];
    candidates?: readonly string[];
    ignore?: readonly string[];
    gitignore?: readonly NextGitignoreEntry[];
}): NextClassPrefix {
    const factsPath = resolveNextStylesheetFactsPath(input.cacheDir);
    const listed = input.tailwindStylesheet.map(file => path.resolve(input.root, file));
    let candidates: readonly string[];
    let gitignore: readonly NextGitignoreEntry[] | undefined;
    if (listed.length > 0) {
        // A named list is the whole answer; what git ignores does not change it.
        candidates = listed;
    } else if (input.candidates === undefined) {
        const walked = walkStylesheets(
            input.root,
            input.ignore ?? recordedIgnore(input.cacheDir, input.root),
        );
        candidates = walked.files;
        gitignore = gitignoreFingerprint(walked.gitignoreFiles);
    } else {
        candidates = input.candidates;
        gitignore = input.gitignore ?? recordedGitignoreNow(input.cacheDir);
    }
    const read = readNextStylesheetFacts(input.cacheDir, {
        root: input.root,
        candidates,
        ignore: input.ignore,
        gitignore,
    });
    if (read.ok) {
        const decided = read.record.entries.filter(entry => entry.dependency);
        return {
            ok: true,
            prefix: read.record.facts?.prefix ?? null,
            dependencies: [factsPath, ...decided.map(entry => entry.file)],
        };
    }
    if (candidates.some(file => mayReachTailwind(readText(file) ?? '@import'))) {
        return { ok: false, reason: read.reason };
    }
    // The candidates are dependencies too: an `@import "tailwindcss"` added to
    // one later has to re-run the loader.
    return { ok: true, prefix: null, dependencies: [factsPath, ...candidates] };
}

/**
 * What a synchronous Next lane says when it has no prefix to lower with.
 *
 * @param root - The Next app root.
 * @param reason - Why the facts could not be used.
 * @param lane - Which lane is asking, as the message names it.
 * @returns The message.
 */
export function unreadNextPrefixMessage(root: string, reason: string, lane: string): string {
    return (
        `[csszyx] ${lane} has not read the Tailwind prefix for ${root}: ${reason}.\n` +
        '  help: run `csszyx next prebuild` before `next build`, and `csszyx next watch` beside `next dev`; both read the stylesheets first.\n' +
        '  note: without the prefix every class this lane emits could style nothing.'
    );
}

/**
 * Record the facts for a Next app, resolving its root and cache directory the
 * way the prebuild and the loader do.
 *
 * @param input - How the command was pointed at the app.
 * @param input.explicitRoot - The app root, when given.
 * @param input.cwd - The working directory, used when no root is given.
 * @param input.cacheDir - The csszyx cache directory, relative to the root.
 * @param input.tailwindStylesheet - The stylesheets the app loads, when named.
 * @param input.files - The app's source files, whose stylesheet imports are
 *        read too: a stylesheet imported from a package is not on the walk.
 * @param input.ignore - Glob patterns the command was told to ignore, relative
 *        to the root; the recorded ones when not given.
 * @param input.setting - What messages call the setting that names the stylesheets.
 * @param input.ignoreSetting - What messages call the setting that carries
 *        `ignore`, on a lane that has one.
 * @returns The record, where it lives, and any warning to print.
 */
export async function prepareNextStylesheetFacts(input: {
    explicitRoot?: string;
    cwd?: string;
    cacheDir?: string;
    tailwindStylesheet?: readonly string[];
    files?: readonly string[];
    ignore?: readonly string[];
    setting?: string;
    ignoreSetting?: string;
}): Promise<{
    record: NextStylesheetFactsRecord;
    path: string;
    warning: string | null;
    /** The compiled design system, for the registration the same command writes. */
    model: ProjectStyleModel;
}> {
    const { root } = resolveNextAppRoot({ explicitRoot: input.explicitRoot, cwd: input.cwd });
    const sources = (input.files ?? []).flatMap(filePath => {
        const content = readText(filePath);
        return content === null ? [] : [{ filePath, content }];
    });
    // Awaited so a failure anywhere in here rejects rather than throws.
    return await writeNextStylesheetFacts({
        root,
        cacheDir: resolveNextAppCacheDir(root, input.cacheDir),
        tailwindStylesheet: input.tailwindStylesheet,
        extraCandidates: stylesheetsImportedBy(sources, collectSpecifierAliases(root)),
        ignore: input.ignore,
        setting: input.setting,
        ignoreSetting: input.ignoreSetting,
    });
}
