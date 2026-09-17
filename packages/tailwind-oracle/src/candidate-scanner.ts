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
    const start = root === null ? { base, pattern: '**/*' } : root;
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

/**
 * Load the project's Scanner, from its own dependencies or its integration's.
 *
 * @param resolveFrom - Directory whose `package.json` anchors resolution.
 * @returns A scanner, or null when the project has none to load.
 */
export function loadCandidateScanner(resolveFrom: string): CandidateScanner | null {
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
        let oxide: { Scanner?: new (options: { sources: ScanSource[] }) => { scan(): string[] } };
        try {
            oxide = anchor('@tailwindcss/oxide') as typeof oxide;
        } catch {
            continue;
        }
        const { Scanner } = oxide;
        // An oxide from before the Scanner API: another anchor may carry a
        // newer one, and none means no scan rather than a failed build.
        if (typeof Scanner !== 'function') continue;
        return sources => new Scanner({ sources: [...sources] }).scan();
    }
    return null;
}
