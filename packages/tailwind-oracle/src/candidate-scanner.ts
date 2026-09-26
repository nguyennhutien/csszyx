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
import { createRequire } from 'node:module';
import path from 'node:path';

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

/** Tailwind's extractor over text the caller already read. */
export type ContentScanner = (content: string, extension: string) => string[];

/**
 * Load the project's extractor for text already in memory.
 *
 * Each call gets a fresh Scanner: one Scanner reports a candidate only the
 * first time it meets it, and a caller asking per file needs every
 * candidate that file holds.
 *
 * @param resolveFrom - Directory whose `package.json` anchors resolution.
 * @returns A scanner, or null when the project has none to load.
 */
export function loadContentScanner(resolveFrom: string): ContentScanner | null {
    const Scanner = loadScannerClass(resolveFrom);
    if (Scanner === null) return null;
    return (content, extension) => new Scanner({ sources: [] }).scanFiles([{ content, extension }]);
}
