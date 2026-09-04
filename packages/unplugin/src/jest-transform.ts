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
 * project-wide prescan, and a compiler handed one file cannot see them. The
 * entry is matched on the file's path and the hash of its current contents, so
 * an edit since the last build is a miss rather than a wrong answer.
 *
 * The per-file compiler answers otherwise. That is the right answer for an
 * inline `sz` and for one built from a `const` in the same file, and it
 * reports its own fallback for the shapes it cannot resolve, so a suite is
 * never told that an unresolved object compiled to nothing.
 *
 * @module jest-transform
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { transformSource } from '@csszyx/compiler';

/** One entry as the plugin writes it; only the fields this lane reads. */
interface CacheEntry {
    filename?: unknown;
    inputSha256?: unknown;
    result?: { code?: unknown } | null;
}

/**
 * Every `.json` file below a directory, deepest last.
 *
 * @param dir - Directory to walk.
 * @returns Absolute file paths, empty when the directory is absent.
 */
function entryFiles(dir: string): string[] {
    let names: fs.Dirent[];
    try {
        names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const out: string[] = [];
    for (const entry of names) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...entryFiles(full));
        else if (entry.name.endsWith('.json')) out.push(full);
    }
    return out;
}

/**
 * The build output for one file, when the build saw exactly these contents.
 *
 * The cache key the plugin derives folds in the cross-module registry that fed
 * the file, which a test runner does not have and cannot reconstruct, so the
 * entries are matched on what they record about themselves instead: the
 * filename they were produced for, and the hash of the source they were
 * produced from.
 *
 * @param cacheRoot - The transform cache directory, `.csszyx/cache/transform`.
 * @param filename - Absolute path of the file under test.
 * @param source - Its current contents.
 * @returns The compiled code, or null when the build has no matching entry.
 */
export function findCachedTransform(
    cacheRoot: string,
    filename: string,
    source: string,
): string | null {
    const wanted = createHash('sha256').update(source).digest('hex');
    for (const file of entryFiles(cacheRoot)) {
        let entry: CacheEntry;
        try {
            entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheEntry;
        } catch {
            continue;
        }
        if (entry.filename !== filename || entry.inputSha256 !== wanted) continue;
        const code = entry.result?.code;
        if (typeof code === 'string') return code;
    }
    return null;
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
}

/** Files carrying an `sz` prop; others are handed back untouched. */
const DEFAULT_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.mts', '.mjs'] as const;

/**
 * Build the transformer jest calls for every file it loads.
 *
 * @param options - Cache location and which extensions to compile.
 * @returns A transformer with jest's synchronous `process` hook.
 */
export function createTransformer(options: JestTransformOptions = {}): JestTransformer {
    const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    const cacheRoot =
        options.cacheRoot ?? path.resolve(process.cwd(), '.csszyx/cache', 'transform');
    return {
        process(sourceText, sourcePath) {
            if (!extensions.some(extension => sourcePath.endsWith(extension))) {
                return { code: sourceText };
            }
            // The build's answer first: it is the only one that resolves an
            // `sz` object or `szv` factory imported from another module.
            const cached = findCachedTransform(cacheRoot, sourcePath, sourceText);
            if (cached !== null) return { code: cached };
            const result = transformSource(sourceText, sourcePath);
            return { code: result.transformed ? result.code : sourceText };
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
