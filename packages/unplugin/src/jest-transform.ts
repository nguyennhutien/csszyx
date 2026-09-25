/**
 * A jest transformer that gives a test suite the classes the browser gets.
 *
 * Under jest the bundler plugin never runs, so a rendered component carries
 * `sz` as a live prop and no `className`. Every styling assertion then reads
 * the object the author typed rather than the compiled output, and the defect
 * class "this `sz` compiled to nothing" is invisible to the suite, to `tsc`
 * and to CI. Vitest needs none of this — the plugin in `vite.config` already
 * transforms the modules a test imports — so this exists for the runners that
 * cannot host a bundler plugin.
 *
 * Two sources answer, in order.
 *
 * The build's own transform cache is read first. It holds the output the
 * bundler produced, which is the only output that resolves an `sz` object or
 * an `szv` factory imported from another module: those come from the plugin's
 * project-wide prescan, and a compiler handed one file cannot see them. An
 * entry is matched on the file's path and the hash of its current contents, so
 * an edit since the last build is a miss rather than a wrong answer; among the
 * entries that match, only one this compiler wrote without variable mangling
 * is taken, newest first.
 *
 * The per-file compiler answers otherwise. That is the right answer for an
 * inline `sz` and for one built from a `const` in the same file; a shape it
 * cannot resolve keeps the runtime path, exactly as the plugin would.
 *
 * Both answers are finished the way the plugin finishes them: the runtime
 * helpers the compiled code calls are imported, and the diagnostics that say a
 * class is dead are printed. jest applies one transformer per file, so this
 * one hands back TSX; a project's own transformer chains it in front of the
 * one that compiles TSX (see the testing guide).
 *
 * @module jest-transform
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
    VERSION as compilerVersion,
    type SourceTransformResult,
    szFallbackConsequenceOf,
    transformSource,
} from '@csszyx/compiler';

import {
    importMergeRegistration,
    loadsCsszyxRuntime,
    mergeRegistrationPath,
    mergeTableFor,
    mergeTablePath,
} from './merge-registration.js';
import type { MergeOverride } from './merge-signature.js';
import { injectNextRuntimeImports, type NextRuntimeImportUsage } from './next-runtime-injection.js';
import {
    failedNextClassPrefixInputsStamp,
    resolveNextClassPrefix,
} from './next-stylesheet-facts.js';
import { normalizePathSeparators } from './path-normalization.js';

/** The compiled output and what it needs, as both sources shape it. */
interface CompiledFile extends NextRuntimeImportUsage {
    code?: unknown;
    transformed?: unknown;
    diagnostics?: unknown;
    mergeGroups?: unknown;
    mergeOverrides?: unknown;
}

/** One entry as the plugin writes it; only the fields this lane reads. */
interface CacheEntry {
    filename?: unknown;
    inputSha256?: unknown;
    compilerVersion?: unknown;
    mangleVars?: unknown;
    classPrefix?: unknown;
    timestamp?: unknown;
    result?: CompiledFile | null;
}

/**
 * How long a directory's modification time is treated as still moving.
 *
 * A write in the same clock tick as the read leaves the time unchanged, so a
 * directory read this recently is read again on the next refresh rather than
 * trusted — the same racy-timestamp rule git's index applies.
 */
const SETTLE_MS = 2000;

/**
 * A directory's modification time, or the never-read marker when it is gone.
 *
 * @param dir - The directory.
 * @returns Its modification time in milliseconds, or -1.
 */
function mtimeOf(dir: string): number {
    try {
        return fs.statSync(dir).mtimeMs;
    } catch {
        return -1;
    }
}

/**
 * The modification time to remember for a directory just read.
 *
 * @param mtime - The time the directory reported.
 * @returns That time, or a marker forcing the next refresh to read again.
 */
function settled(mtime: number): number {
    return Date.now() - mtime < SETTLE_MS ? -1 : mtime;
}

/**
 * When an entry says it was written, for choosing between two of them.
 *
 * The field arrives as `unknown`: the cache is a directory of JSON files a
 * previous build wrote, and a hand-edited or half-written one can carry
 * anything there. Stringifying an object gives `[object Object]`, which sorts
 * above every ISO date — so a damaged entry would win and the transform served
 * would be the stale one. Anything that is not a string has no claim to a time.
 *
 * @param entry - The cache entry.
 * @returns Its timestamp, or the empty string when it does not have one.
 */
function writtenAt(entry: CacheEntry): string {
    return typeof entry.timestamp === 'string' ? entry.timestamp : '';
}

/**
 * The build's entries, indexed by the file they were produced for.
 *
 * Reading every entry once per lookup made a suite of N files read the cache
 * N times over — 46 ms a file against a full cache, measured. The index reads
 * each entry file once. A lookup that misses asks the directories whether
 * anything changed since they were last read — one `stat` per directory,
 * which is how an entry a rebuild wrote during a watch run is still found
 * without walking ten thousand names to learn that nothing was added.
 */
class TransformCacheIndex {
    /** Directories seen, with the modification time they were last read at. */
    private readonly dirs = new Map<string, number>();
    private readonly seen = new Set<string>();
    private readonly byFilename = new Map<string, CacheEntry[]>();

    /**
     * @param root - The transform cache directory.
     */
    constructor(root: string) {
        this.dirs.set(root, -1);
    }

    /**
     * Read every entry file written since the last refresh.
     */
    refresh(): void {
        // A directory whose modification time moved has a new name in it — a
        // file or a subdirectory. One whose time held has nothing new.
        // Two passes, because `readDir` adds the subdirectories it finds to the
        // same map: deciding first and reading second keeps the walk off a map
        // that is still growing under it.
        const moved: string[] = [];
        for (const [dir, readAt] of this.dirs) {
            const mtime = mtimeOf(dir);
            if (mtime !== readAt) moved.push(dir);
        }
        for (const dir of moved) {
            this.dirs.set(dir, settled(mtimeOf(dir)));
            this.readDir(dir);
        }
    }

    /**
     * Parse the entry files in one directory the index has not read yet.
     *
     * @param dir - The directory.
     */
    private readDir(dir: string): void {
        let names: fs.Dirent[];
        try {
            names = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of names) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!this.dirs.has(full)) {
                    this.dirs.set(full, settled(mtimeOf(full)));
                    this.readDir(full);
                }
                continue;
            }
            if (!entry.name.endsWith('.json') || this.seen.has(full)) continue;
            this.seen.add(full);
            this.add(full);
        }
    }

    /**
     * Parse one entry file into the index.
     *
     * @param file - The entry file.
     */
    private add(file: string): void {
        let entry: CacheEntry;
        try {
            entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheEntry;
        } catch {
            // A half-written entry from an interrupted build: the one beside
            // it may still answer.
            return;
        }
        if (typeof entry.filename !== 'string') return;
        const list = this.byFilename.get(entry.filename) ?? [];
        list.push(entry);
        this.byFilename.set(entry.filename, list);
    }

    /**
     * The build output for one file, when the build saw exactly these contents.
     *
     * @param filename - Path of the file under test, as the plugin records it.
     * @param source - Its current contents.
     * @param classPrefix - The Tailwind prefix the project sets, or null.
     * @returns The matching entry's result, or null.
     */
    find(filename: string, source: string, classPrefix: string | null): CompiledFile | null {
        const wanted = createHash('sha256').update(source).digest('hex');
        const hit = this.pick(filename, wanted, classPrefix);
        if (hit !== null) return hit;
        this.refresh();
        return this.pick(filename, wanted, classPrefix);
    }

    /**
     * The best entry among those recorded for one file and hash.
     *
     * The plugin keys its cache on more than the source — the compiler that
     * wrote the entry, whether variables were mangled, the cross-module
     * registry — so one file and hash can have several entries. A test wants
     * the output this compiler produces with readable variable names, and of
     * those the newest.
     *
     * @param filename - Path as the plugin records it.
     * @param sha256 - Hash of the current contents.
     * @param classPrefix - The Tailwind prefix the project sets, or null.
     * @returns The chosen entry's result, or null when none qualifies.
     */
    private pick(
        filename: string,
        sha256: string,
        classPrefix: string | null,
    ): CompiledFile | null {
        let best: CacheEntry | null = null;
        for (const entry of this.byFilename.get(filename) ?? []) {
            if (entry.inputSha256 !== sha256) continue;
            if (entry.compilerVersion !== compilerVersion || entry.mangleVars === true) continue;
            // Output lowered under another prefix names classes this project
            // does not serve. An entry older than the field was lowered with none.
            if ((entry.classPrefix ?? null) !== classPrefix) continue;
            if (typeof entry.result?.code !== 'string') continue;
            if (best === null || writtenAt(entry) > writtenAt(best)) {
                best = entry;
            }
        }
        return best?.result ?? null;
    }
}

/**
 * The build output for one file, when the build saw exactly these contents.
 *
 * One-shot form of the index, for a caller outside a transformer.
 *
 * @param cacheRoot - The transform cache directory, `.csszyx/cache/transform`.
 * @param filename - Path of the file under test.
 * @param source - Its current contents.
 * @param classPrefix - The Tailwind prefix the project sets, or null.
 * @returns The compiled code, or null when the build has no matching entry.
 */
export function findCachedTransform(
    cacheRoot: string,
    filename: string,
    source: string,
    classPrefix: string | null = null,
): string | null {
    const index = new TransformCacheIndex(cacheRoot);
    index.refresh();
    const code = index.find(normalizePathSeparators(filename), source, classPrefix)?.code;
    return typeof code === 'string' ? code : null;
}

/** How the transformer finds the build output and what it compiles. */
export interface JestTransformOptions {
    /**
     * The transform cache directory. Defaults to `.csszyx/cache/transform`
     * under the project root, which is where the plugin writes it.
     */
    cacheRoot?: string;
    /** Extensions this lane compiles; anything else is returned unchanged. */
    extensions?: readonly string[];
    /**
     * The project root the stylesheets are read from. Defaults to the
     * `rootDir` of the jest project the file belongs to, so each app under
     * `projects` reads its own; the directory jest runs from when jest gives none.
     */
    root?: string;
    /** The stylesheets the app loads, when the project also holds others. */
    tailwindStylesheet?: string | string[];
    /**
     * Glob patterns, relative to the root, for directories that hold another
     * app; their stylesheets do not vote on the Tailwind prefix. One pattern
     * per entry, not a comma-separated text. On Next.js, the patterns given to
     * `csszyx next prebuild --ignore`: this option replaces the recorded ones,
     * and without it the recorded ones are followed. Set it where the suite
     * runs before any command has recorded them.
     */
    ignore?: string | string[];
    /**
     * Whether a class a later one on the same element covers is dropped, as
     * the bundler lanes spell `build.mergeCoveredClasses`. On unless set; the
     * table comes from `.csszyx/merge-table.json`, which the build or
     * `csszyx next prebuild` writes.
     */
    mergeCoveredClasses?: boolean;
}

/** The slice of the options jest hands `process` that this lane reads. */
export interface JestProcessOptions {
    /** The jest project the file belongs to. */
    config?: { rootDir?: string };
    /** True when jest runs native ES modules rather than CommonJS. */
    supportsStaticESM?: boolean;
}

/** The options jest hands `getCacheKey`; only the fields this lane folds in. */
export interface JestCacheKeyOptions extends JestProcessOptions {
    /** jest's serialised config, which its default key includes. */
    configString?: string;
}

/** The slice of jest's transformer interface this implements. */
export interface JestTransformer {
    /**
     * Compile one file.
     *
     * @param sourceText - File contents.
     * @param sourcePath - Absolute path of the file.
     * @param options - What jest says about the project the file belongs to.
     * @returns The code jest executes.
     */
    process(sourceText: string, sourcePath: string, options?: JestProcessOptions): { code: string };
    /**
     * The key jest caches the output under.
     *
     * jest's own key covers the file and its config, and this lane's answer
     * also depends on what the last build wrote for the file: a rebuild after
     * a change in another module changes this file's output without changing
     * this file. The build's answer is part of the key so that jest asks again.
     *
     * @param sourceText - File contents.
     * @param sourcePath - Absolute path of the file.
     * @param options - jest's cache-key options.
     * @returns A hex digest.
     */
    getCacheKey(sourceText: string, sourcePath: string, options?: JestCacheKeyOptions): string;
}

/**
 * The program a child process runs to read the stylesheets.
 *
 * Reading the prefix means compiling the stylesheets, which is asynchronous,
 * and jest calls a transformer synchronously. A child process can take as long
 * as the compile needs while this one waits for it. It records the facts file
 * the build writes, so the next jest run reads the file instead.
 */
const READ_STYLESHEETS = `
const [, entry, input] = process.argv;
try {
    const { prepareNextStylesheetFacts } = await import(entry);
    const { record, warning } = await prepareNextStylesheetFacts(JSON.parse(input));
    if (warning !== null) process.stderr.write(warning);
    process.stdout.write(JSON.stringify(record.facts?.prefix ?? null));
} catch (error) {
    process.stderr.write(error.message);
    process.exit(1);
}
`;

/**
 * Read the stylesheets in a child process and record what they settled.
 *
 * @param input - Where the project is and which stylesheets it loads.
 * @param input.root - The project root.
 * @param input.cacheDir - The csszyx cache directory.
 * @param input.tailwindStylesheet - The stylesheets the app loads, when named.
 * @param input.ignore - The transformer's own ignore patterns, when it has any.
 * @returns The prefix they set, or null.
 */
function readStylesheetsInChild(input: {
    root: string;
    cacheDir: string;
    tailwindStylesheet: readonly string[];
    ignore: readonly string[] | undefined;
}): string | null {
    // One path from both builds of this file: `src/` and `dist/` sit side by
    // side, so the prebuild entry is found the same way from either.
    const entry = new URL('../dist/next-prebuild.mjs', import.meta.url).href;
    const result = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            READ_STYLESHEETS,
            entry,
            JSON.stringify({
                explicitRoot: input.root,
                cacheDir: input.cacheDir,
                tailwindStylesheet: input.tailwindStylesheet,
                ignore: input.ignore,
                ignoreSetting: 'the csszyx `ignore` option',
            }),
        ],
        { encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    if (result.stderr !== '') console.warn(result.stderr);
    return JSON.parse(result.stdout) as string | null;
}

/** Files carrying an `sz` prop; others are handed back untouched. */
const DEFAULT_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.mts', '.mjs'] as const;

/**
 * Print the diagnostics that say a class is dead.
 *
 * A usage nudge — the runtime path taken where a compiled one was possible —
 * is the plugin's business; under jest the runtime path renders the same
 * classes. A dead key or value, or missing CSS, is the finding this lane
 * exists to surface, and it goes to the console the way the plugin's does.
 *
 * @param sourcePath - The file the diagnostics belong to.
 * @param diagnostics - The result's diagnostics, whatever their shape.
 */
function reportDeadClasses(sourcePath: string, diagnostics: unknown): void {
    if (!Array.isArray(diagnostics)) return;
    for (const message of diagnostics) {
        if (typeof message !== 'string' || szFallbackConsequenceOf(message) === 'nudge') continue;
        console.warn(`[csszyx] ${sourcePath}\n  ${message}`);
    }
}

/**
 * Finish compiled code the way the plugin does before handing it to a bundler.
 *
 * @param code - The compiled module.
 * @param usage - Which runtime helpers it calls.
 * @param classPrefix - The Tailwind prefix to register for runtime lowering, or null.
 * @returns The module with those helpers imported.
 */
function finish(code: string, usage: NextRuntimeImportUsage, classPrefix: string | null): string {
    return injectNextRuntimeImports(code, usage, classPrefix).code;
}

/**
 * Import the merge registration the last build settled, from a module that
 * loads the csszyx runtime.
 *
 * A test run has no bundler to settle the table under, and `szcn` merges
 * nothing without one. A build, or `csszyx next prebuild`, writes the settled
 * module beside the cache; importing it is what makes the suite merge the way
 * the browser does. Before a build has written it the module is left alone.
 *
 * @param code - The code jest would execute.
 * @param sourcePath - Absolute path of the file.
 * @param root - The project root.
 * @param format - The twin this jest can load.
 * @returns The code, importing the module when it exists.
 */
function withMergeRegistration(
    code: string,
    sourcePath: string,
    root: string,
    format: 'esm' | 'cjs',
): string {
    if (!loadsCsszyxRuntime(code)) return code;
    return importMergeRegistration(code, sourcePath, root, format).code;
}

/**
 * The twin of the settled module a jest run can load.
 *
 * @param jestOptions - What jest says about the run.
 * @returns `esm` for a jest running native ES modules, `cjs` otherwise.
 */
function formatOf(jestOptions: JestProcessOptions | undefined): 'esm' | 'cjs' {
    return jestOptions?.supportsStaticESM === true ? 'esm' : 'cjs';
}

/**
 * The file compiled again with the settled merge table, when that table drops
 * a class from one of the lists the first pass reported.
 *
 * A pass with a table compiles the file on its own, so an `sz` imported from
 * another module resolves at run time there instead of from the build's
 * answer; the classes it renders are the same.
 *
 * @param first - What the first pass reported.
 * @param first.mergeGroups - Each static object's classes.
 * @param first.mergeOverrides - Each static class name beside a static `sz`.
 * @param compile - Compiles the file with a table.
 * @param root - The project root the table lives under.
 * @returns The merged result, or null when nothing merges.
 */
function mergedWithSettledTable<T>(
    first: { mergeGroups?: unknown; mergeOverrides?: unknown },
    compile: (mergeTable: NonNullable<ReturnType<typeof mergeTableFor>>) => T,
    root: string,
): T | null {
    const groups = Array.isArray(first.mergeGroups) ? (first.mergeGroups as string[][]) : [];
    const overrides = Array.isArray(first.mergeOverrides)
        ? (first.mergeOverrides as MergeOverride[])
        : [];
    const mergeTable = mergeTableFor(root, groups, overrides);
    return mergeTable === null ? null : compile(mergeTable);
}

/**
 * A file's text, or empty when it cannot be read.
 *
 * @param file - The path.
 * @returns The text.
 */
function textOrEmpty(file: string): string {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

/**
 * The settled module's text, for the cache key.
 *
 * @param root - The project root.
 * @param format - The twin this jest imports.
 * @returns The text, or empty when no build has written it.
 */
function mergeRegistrationText(root: string, format: 'esm' | 'cjs'): string {
    try {
        return fs.readFileSync(mergeRegistrationPath(root, format), 'utf8');
    } catch {
        return '';
    }
}

/**
 * Build the transformer jest calls for every file it loads.
 *
 * @param options - Cache location and which extensions to compile.
 * @returns A transformer with jest's synchronous hooks.
 */
export function createTransformer(options: JestTransformOptions = {}): JestTransformer {
    const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    // One per project root: jest started at a monorepo root runs each app
    // under `projects` with its own rootDir, in the same worker.
    const projects = new Map<string, JestProject>();
    const projectOf = (jestOptions?: JestProcessOptions): JestProject => {
        const root = options.root ?? jestOptions?.config?.rootDir ?? process.cwd();
        let project = projects.get(root);
        if (project === undefined) {
            project = openJestProject(root, options);
            projects.set(root, project);
        }
        return project;
    };
    const compiles = (sourcePath: string): boolean =>
        extensions.some(extension => sourcePath.endsWith(extension));
    return {
        process(sourceText, sourcePath, jestOptions) {
            if (!compiles(sourcePath)) return { code: sourceText };
            const { cached, classPrefix, root } = projectOf(jestOptions);
            const prefix = classPrefix();
            // jest in its default mode cannot load an ES module, and one that
            // runs native ESM imports the runtime's ES build, which a CommonJS
            // twin would not register into.
            const format = formatOf(jestOptions);
            const merges = (code: string): string =>
                withMergeRegistration(code, sourcePath, root, format);
            // The build's answer first: it is the only one that resolves an
            // `sz` object or `szv` factory imported from another module.
            const built = cached(sourceText, sourcePath, prefix);
            const withTable = (first: CompiledFile): SourceTransformResult | null =>
                options.mergeCoveredClasses === false
                    ? null
                    : mergedWithSettledTable(
                          first,
                          mergeTable =>
                              transformSource(sourceText, sourcePath, {
                                  classPrefix: prefix,
                                  mergeTable,
                              }),
                          root,
                      );
            if (built !== null && typeof built.code === 'string') {
                reportDeadClasses(sourcePath, built.diagnostics);
                const merged = withTable(built);
                return {
                    code: merges(
                        merged === null
                            ? finish(built.code, built, prefix)
                            : finish(merged.code, merged, prefix),
                    ),
                };
            }
            const first = transformSource(sourceText, sourcePath, { classPrefix: prefix });
            const result = withTable(first) ?? first;
            reportDeadClasses(sourcePath, result.diagnostics);
            return {
                code: merges(result.transformed ? finish(result.code, result, prefix) : sourceText),
            };
        },
        getCacheKey(sourceText, sourcePath, cacheKeyOptions) {
            const compiled = compiles(sourcePath);
            const project = compiled ? projectOf(cacheKeyOptions) : null;
            const prefix = project?.classPrefix() ?? null;
            const built = project === null ? null : project.cached(sourceText, sourcePath, prefix);
            return (
                createHash('sha256')
                    .update(sourceText)
                    .update('\0')
                    .update(sourcePath)
                    .update('\0')
                    .update(typeof built?.code === 'string' ? built.code : '')
                    .update('\0')
                    .update(cacheKeyOptions?.configString ?? '')
                    .update('\0')
                    .update(compilerVersion)
                    .update('\0')
                    // Output lowered under one prefix is wrong under another.
                    .update(project === null ? '' : JSON.stringify(prefix))
                    .update('\0')
                    // A build that settled a different table must reach the
                    // suite, and the file it wrote is imported by path.
                    .update(
                        project === null
                            ? ''
                            : mergeRegistrationText(project.root, formatOf(cacheKeyOptions)),
                    )
                    .update('\0')
                    // The table the file's own merge reads, which a build or
                    // `next prebuild` settles apart from the registration.
                    .update(project === null ? '' : textOrEmpty(mergeTablePath(project.root)))
                    .digest('hex')
            );
        },
    };
}

/** What the transformer knows about one project root. */
interface JestProject {
    /** The project root, where the build writes what a test run reads. */
    root: string;
    /**
     * The build's output for a file, when it saw these contents.
     *
     * @param sourceText - File contents.
     * @param sourcePath - Absolute path of the file.
     * @param classPrefix - The freshly resolved Tailwind prefix.
     * @returns The cached output, or null.
     */
    cached(sourceText: string, sourcePath: string, classPrefix: string | null): CompiledFile | null;
    /**
     * The Tailwind prefix the project's stylesheets set.
     *
     * @returns The prefix, or null for none.
     */
    classPrefix(): string | null;
}

/**
 * Open the transform cache and the prefix of one project root.
 *
 * @param root - The project root.
 * @param options - The transformer's options.
 * @returns The project.
 */
function openJestProject(root: string, options: JestTransformOptions): JestProject {
    const cacheRoot = options.cacheRoot ?? path.resolve(root, '.csszyx/cache', 'transform');
    // The facts file lives beside the transform cache, as the build writes it.
    const cacheDir = path.dirname(cacheRoot);
    const tailwindStylesheet = [options.tailwindStylesheet ?? []].flat();
    // Undefined, not empty, when the option is absent: the recorded patterns
    // are followed then, and an empty list says to follow none.
    const ignore = options.ignore === undefined ? undefined : [options.ignore].flat();
    // The Turbopack loader follows whatever patterns the shared facts hold. A
    // suite with patterns of its own keeps its own facts, so running it cannot
    // change which stylesheets `next dev` lets vote.
    const factsDir = ignore === undefined ? cacheDir : path.join(cacheDir, 'jest');
    const index = new TransformCacheIndex(cacheRoot);
    index.refresh();
    // A failure is reused only while its inputs are byte-for-byte unchanged:
    // every file would otherwise pay for the same child process. Successful
    // answers are cheap to validate and must observe edits during watch mode.
    let failedPrefix: { stamp: string; error: Error } | undefined;
    const classPrefix = (): string | null => {
        const inputs = { root, cacheDir: factsDir, tailwindStylesheet, ignore };
        // Stamping walks with the same patterns, so a pattern that cannot be
        // honoured fails here too. The options never change within a worker,
        // which makes one fixed stamp the right memo for that failure.
        const stampOf = (): string => {
            try {
                return failedNextClassPrefixInputsStamp(inputs);
            } catch {
                return 'inputs cannot be read';
            }
        };
        if (failedPrefix !== undefined) {
            if (stampOf() === failedPrefix.stamp) throw failedPrefix.error;
            failedPrefix = undefined;
        }
        try {
            const recorded = resolveNextClassPrefix(inputs);
            return recorded.ok ? recorded.prefix : readStylesheetsInChild(inputs);
        } catch (error) {
            const settled = error as Error;
            failedPrefix = { stamp: stampOf(), error: settled };
            throw settled;
        }
    };
    return {
        root,
        cached: (sourceText, sourcePath, prefix) =>
            index.find(normalizePathSeparators(sourcePath), sourceText, prefix),
        classPrefix,
    };
}

/** The module shape jest resolves a transformer by. */
interface JestTransformerFactory {
    /**
     * Build the transformer.
     *
     * @param options - Cache location and which extensions to compile.
     * @returns The transformer.
     */
    createTransformer: (options?: JestTransformOptions) => JestTransformer;
}

/** jest resolves a transformer module by its default export. */
const transformerModule: JestTransformerFactory = { createTransformer };

export default transformerModule;
