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

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
    VERSION as compilerVersion,
    szFallbackConsequenceOf,
    transformSource,
} from '@csszyx/compiler';

import { injectNextRuntimeImports, type NextRuntimeImportUsage } from './next-runtime-injection.js';
import { normalizePathSeparators } from './path-normalization.js';

/** The compiled output and what it needs, as both sources shape it. */
interface CompiledFile extends NextRuntimeImportUsage {
    code?: unknown;
    transformed?: unknown;
    diagnostics?: unknown;
}

/** One entry as the plugin writes it; only the fields this lane reads. */
interface CacheEntry {
    filename?: unknown;
    inputSha256?: unknown;
    compilerVersion?: unknown;
    mangleVars?: unknown;
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
        for (const [dir, readAt] of [...this.dirs]) {
            const mtime = mtimeOf(dir);
            if (mtime === readAt) continue;
            this.dirs.set(dir, settled(mtime));
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
     * @returns The matching entry's result, or null.
     */
    find(filename: string, source: string): CompiledFile | null {
        const wanted = createHash('sha256').update(source).digest('hex');
        const hit = this.pick(filename, wanted);
        if (hit !== null) return hit;
        this.refresh();
        return this.pick(filename, wanted);
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
     * @returns The chosen entry's result, or null when none qualifies.
     */
    private pick(filename: string, sha256: string): CompiledFile | null {
        let best: CacheEntry | null = null;
        for (const entry of this.byFilename.get(filename) ?? []) {
            if (entry.inputSha256 !== sha256) continue;
            if (entry.compilerVersion !== compilerVersion || entry.mangleVars === true) continue;
            if (typeof entry.result?.code !== 'string') continue;
            if (best === null || String(entry.timestamp ?? '') > String(best.timestamp ?? '')) {
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
 * @returns The compiled code, or null when the build has no matching entry.
 */
export function findCachedTransform(
    cacheRoot: string,
    filename: string,
    source: string,
): string | null {
    const index = new TransformCacheIndex(cacheRoot);
    index.refresh();
    const code = index.find(normalizePathSeparators(filename), source)?.code;
    return typeof code === 'string' ? code : null;
}

/** How the transformer finds the build output and what it compiles. */
export interface JestTransformOptions {
    /**
     * The transform cache directory. Defaults to `.csszyx/cache/transform`
     * under the current working directory, which is where the plugin writes
     * it and where jest runs from.
     */
    cacheRoot?: string;
    /** Extensions this lane compiles; anything else is returned unchanged. */
    extensions?: readonly string[];
}

/** The options jest hands `getCacheKey`; only the field this lane folds in. */
export interface JestCacheKeyOptions {
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
     * @returns The code jest executes.
     */
    process(sourceText: string, sourcePath: string): { code: string };
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
 * @returns The module with those helpers imported.
 */
function finish(code: string, usage: NextRuntimeImportUsage): string {
    return injectNextRuntimeImports(code, usage).code;
}

/**
 * Build the transformer jest calls for every file it loads.
 *
 * @param options - Cache location and which extensions to compile.
 * @returns A transformer with jest's synchronous hooks.
 */
export function createTransformer(options: JestTransformOptions = {}): JestTransformer {
    const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    const cacheRoot =
        options.cacheRoot ?? path.resolve(process.cwd(), '.csszyx/cache', 'transform');
    const index = new TransformCacheIndex(cacheRoot);
    index.refresh();
    const compiles = (sourcePath: string): boolean =>
        extensions.some(extension => sourcePath.endsWith(extension));
    const cached = (sourceText: string, sourcePath: string): CompiledFile | null =>
        index.find(normalizePathSeparators(sourcePath), sourceText);
    return {
        process(sourceText, sourcePath) {
            if (!compiles(sourcePath)) return { code: sourceText };
            // The build's answer first: it is the only one that resolves an
            // `sz` object or `szv` factory imported from another module.
            const built = cached(sourceText, sourcePath);
            if (built !== null && typeof built.code === 'string') {
                reportDeadClasses(sourcePath, built.diagnostics);
                return { code: finish(built.code, built) };
            }
            const result = transformSource(sourceText, sourcePath);
            reportDeadClasses(sourcePath, result.diagnostics);
            return { code: result.transformed ? finish(result.code, result) : sourceText };
        },
        getCacheKey(sourceText, sourcePath, cacheKeyOptions) {
            const built = compiles(sourcePath) ? cached(sourceText, sourcePath) : null;
            return createHash('sha256')
                .update(sourceText)
                .update('\0')
                .update(sourcePath)
                .update('\0')
                .update(typeof built?.code === 'string' ? built.code : '')
                .update('\0')
                .update(cacheKeyOptions?.configString ?? '')
                .update('\0')
                .update(compilerVersion)
                .digest('hex');
        },
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
