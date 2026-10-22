/**
 * The value-import graph of the sources: which files a source file loads at
 * run time. The walk lives in `scripts/diagnostics/browser-sources.mjs`,
 * which the diagnostic generator reads too; this module types it for tests.
 */
import path from 'node:path';

import * as graph from '../../../../scripts/diagnostics/browser-sources.mjs';

/** The repository's `packages` directory. */
export const packages: string = path.join(graph.REPO_ROOT as string, 'packages') + path.sep;
/** The compiler's sources. */
export const compilerSrc: string = path.join(packages, 'compiler/src');

/**
 * The modules a file imports, re-exports or loads with `import()` for values.
 *
 * @param text - The file's source.
 * @returns The module specifiers.
 */
export function valueImports(text: string): string[] {
    return graph.valueImports(text);
}

/**
 * The compiler source a `@csszyx/compiler` specifier loads.
 *
 * @param spec - `@csszyx/compiler` or one of its subpaths.
 * @returns The source file.
 */
export function compilerEntry(spec: string): string {
    return graph.compilerEntry(spec);
}

/**
 * Every file a source file reaches through value imports.
 *
 * @param entries - The first files.
 * @returns The files, the entries included.
 */
export function reachable(entries: string[]): Set<string> {
    return graph.reachable(entries);
}

/**
 * The compiler's own browser subpaths, read from its `exports`.
 *
 * @returns The subpaths.
 */
export function compilerBrowserSubpaths(): string[] {
    return graph.compilerBrowserSubpaths();
}

/**
 * Every source a browser bundle can start from.
 *
 * @returns The files.
 */
export function browserRoots(): string[] {
    return graph.browserRoots();
}
