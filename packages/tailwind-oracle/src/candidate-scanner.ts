/**
 * The class names a project's Tailwind finds in its sources.
 *
 * Tailwind generates CSS for every candidate its Scanner finds, and the
 * Scanner is `@tailwindcss/oxide`, which an app reaches only through the
 * integration it installed (`@tailwindcss/postcss`, `@tailwindcss/vite`, …).
 * Reading the same sources the same way gives the exact vocabulary the
 * project's CSS was generated from, without a second scanner to keep in step.
 *
 * @module
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { sortStrings } from '@csszyx/compiler';

import { createGitignoreQuery } from './project-walk.js';

/** One place Tailwind scans, in the shape its Scanner takes. */
export interface ScanSource {
    base: string;
    pattern: string;
    negated: boolean;
}

/** What `compile()` reports about where a stylesheet's classes come from. */
export interface CompiledSources {
    /** `source(...)` on the Tailwind import: none, automatic, or one path. */
    root: 'none' | null | { base: string; pattern: string };
    /** The stylesheet's `@source` rules. */
    sources: readonly ScanSource[];
}

/** Scan a set of sources for candidates. */
export type CandidateScanner = (sources: readonly ScanSource[]) => string[];

/**
 * Where a stylesheet's Scanner looks, exactly as Tailwind's integrations
 * build it: nothing for `source(none)`, the whole base for no `source(...)`,
 * the named path otherwise, then every `@source` rule.
 *
 * @param compiled - What `compile()` reported.
 * @param base - Where automatic detection starts: the project root.
 * @returns The Scanner's sources.
 */
export function scanSourcesOf(compiled: CompiledSources, base: string): ScanSource[] {
    const { root } = compiled;
    if (root === 'none') return [...compiled.sources];
    const start = root ?? { base, pattern: '**/*' };
    return [{ ...start, negated: false }, ...compiled.sources];
}

/** Integrations that carry the Scanner, in the order an app is likely to have one. */
const INTEGRATIONS = [
    '@tailwindcss/postcss',
    '@tailwindcss/vite',
    '@tailwindcss/webpack',
    '@tailwindcss/cli',
    '@tailwindcss/node',
] as const;

/** The part of oxide's Scanner this module uses. */
interface OxideScanner {
    scan(): string[];
    scanFiles(input: Array<{ content: string; extension: string }>): string[];
    /** The files its sources reach, without reading them. */
    readonly files?: string[];
}

/** The Scanner class of the oxide an anchor resolves. */
type OxideScannerClass = new (options: { sources: ScanSource[] }) => OxideScanner;

/**
 * The project's Scanner class, from its own dependencies or its integration's.
 *
 * @param resolveFrom - Directory whose `package.json` anchors resolution.
 * @returns The class, or null when the project has none to load.
 */
function loadScannerClass(resolveFrom: string): OxideScannerClass | null {
    const project = createRequire(path.join(resolveFrom, 'package.json'));
    const anchors = [
        project,
        ...INTEGRATIONS.flatMap(name => {
            try {
                return [createRequire(project.resolve(name))];
            } catch {
                return [];
            }
        }),
    ];
    for (const anchor of anchors) {
        let oxide: { Scanner?: OxideScannerClass };
        try {
            oxide = anchor('@tailwindcss/oxide') as typeof oxide;
        } catch {
            continue;
        }
        const { Scanner } = oxide;
        // An oxide from before the Scanner API: another anchor may carry a
        // newer one, and none means no scan rather than a failed build.
        if (typeof Scanner !== 'function') continue;
        return Scanner;
    }
    return null;
}

/**
 * Load the project's Scanner, from its own dependencies or its integration's.
 *
 * @param resolveFrom - Directory whose `package.json` anchors resolution.
 * @returns A scanner, or null when the project has none to load.
 */
export function loadCandidateScanner(resolveFrom: string): CandidateScanner | null {
    const Scanner = loadScannerClass(resolveFrom);
    if (Scanner === null) return null;
    return sources => new Scanner({ sources: [...sources] }).scan();
}

/**
 * The files the project's explicit sources make Tailwind read: every
 * `@source` rule and a `source(...)` path, per stylesheet, as its own Scanner
 * lists them.
 *
 * The sz walk skips what `.gitignore` covers, as Tailwind's automatic
 * detection does (ADR 0033), and takes these back, so a folder or file a
 * stylesheet names reaches the safelist too. The Scanner decides, not a copy
 * of its rules: a single-file rule names that file and not its folder, a
 * folder whose own `.gitignore` ignores everything is still read, and each
 * stylesheet's `@source not` applies to that stylesheet only. Beside
 * automatic detection, a rule into a gitignored folder opens the whole folder
 * (oxide 4.3.3, for a glob and for a single file), so for such a stylesheet
 * the gitignored files of its full list are named too.
 *
 * A rule into `node_modules` is left out before the Scanner is built: no
 * prescan reads a dependency, and listing one costs a walk of the package.
 *
 * Cost: one Scanner per stylesheet that has an explicit rule, walking only
 * what its rules name, and a second over its whole list when it also has
 * automatic detection, which Tailwind walks for the same stylesheet. A
 * stylesheet with automatic detection alone builds none, so the common
 * project pays nothing. Sorted and deduplicated, so the answer does not
 * depend on stylesheet order. Node only; both the build prescan and
 * `csszyx check` call it.
 *
 * @param resolveFrom - Directory whose `package.json` anchors resolution.
 * @param autoBase - Where automatic detection starts: its `**` rule there is
 *        recognised, as the walk already covers what it reads.
 * @param roots - Each stylesheet's Scanner sources, from {@link scanSourcesOf}.
 * @returns Absolute paths, under `autoBase` spelled as given even when it is
 *          reached through a link, or null when the project has no Scanner
 *          to ask.
 */
export function filesNamedBySources(
    resolveFrom: string,
    autoBase: string,
    roots: ReadonlyArray<readonly ScanSource[]>,
): string[] | null {
    const automatic = (source: ScanSource): boolean =>
        !source.negated && source.pattern === '**/*' && source.base === autoBase;
    const explicit = (source: ScanSource): boolean => !source.negated && !automatic(source);
    const asked = roots
        .map(sources => sources.filter(source => !(explicit(source) && namesDependency(source))))
        .filter(sources => sources.some(explicit));
    if (asked.length === 0) return [];
    const Scanner = loadScannerClass(resolveFrom);
    if (Scanner === null) return null;
    const given = spellingUnder(autoBase);
    let gitignored: ((file: string) => boolean) | undefined;
    const files = new Set<string>();
    for (const sources of asked) {
        const named = new Scanner({ sources: sources.filter(source => !automatic(source)) }).files;
        // An oxide whose Scanner lists no files cannot be asked.
        if (!Array.isArray(named)) return null;
        for (const file of named) files.add(given(file));
        if (!sources.some(automatic)) continue;
        gitignored ??= createGitignoreQuery(autoBase);
        // The same oxide answered the listing above with an array.
        const full = new Scanner({ sources: [...sources] }).files as string[];
        for (const file of full) {
            const spelled = given(file);
            if (gitignored(spelled)) files.add(spelled);
        }
    }
    return sortStrings(files);
}

/**
 * Whether a rule points into a `node_modules` folder.
 *
 * @param source - The rule.
 * @returns True when a segment of its path is `node_modules`.
 */
function namesDependency(source: ScanSource): boolean {
    return path.resolve(source.base, source.pattern).split(/[\\/]/).includes('node_modules');
}

/**
 * A path unchanged.
 *
 * @param file - The path.
 * @returns The same path.
 */
const samePath = (file: string): string => file;

/**
 * Turn a path the Scanner reports, which is real, into the spelling a caller
 * gave for the folder above it: a project reached through a link (`/tmp` on
 * macOS) or by a Windows short name (`RUNNER~1`) compares its walk against
 * the paths it was given. Only the native realpath expands a short name, as
 * in `project-walk.ts`.
 *
 * @param base - The folder as the caller spells it.
 * @returns The rewrite; the identity when the folder is its own real path.
 */
function spellingUnder(base: string): (file: string) => string {
    let real: string;
    try {
        real = fs.realpathSync.native(base);
    } catch {
        return samePath;
    }
    if (real === base) return samePath;
    const prefix = path.join(real, path.sep);
    return file => (file.startsWith(prefix) ? path.join(base, file.slice(prefix.length)) : file);
}

/** Text the caller already read, and its extension without the dot. */
export interface ContentFile {
    readonly content: string;
    readonly extension: string;
}

/** Tailwind's extractor over text the caller already read: every file's candidates, together. */
export type ContentScanner = (files: readonly ContentFile[]) => string[];

/**
 * Load the project's extractor for text already in memory.
 *
 * Each call gets a fresh Scanner: one Scanner reports a candidate only the
 * first time it meets it, and a caller needs every candidate its files hold.
 * Ask for many files in one call where you can: Scanner splits each call's
 * work across its thread pool, 0.25 ms for a 1.4 KB file asked alone against
 * 3.4 ms for 800 of them asked together.
 *
 * @param resolveFrom - Directory whose `package.json` anchors resolution.
 * @returns A scanner, or null when the project has none to load.
 */
export function loadContentScanner(resolveFrom: string): ContentScanner | null {
    const Scanner = loadScannerClass(resolveFrom);
    if (Scanner === null) return null;
    // Only the two fields: an entry that also carries `file` came back with no
    // candidates for its in-memory content (oxide 4.3.3).
    return files =>
        new Scanner({ sources: [] }).scanFiles(
            files.map(({ content, extension }) => ({ content, extension })),
        );
}
