/**
 * What counts as a cross-module provider on disk.
 *
 * Two lanes resolve a specifier against the filesystem rather than against a
 * prescan's walk: the Turbopack loader, which has no walk, and the watch
 * refresh, which sees one changed file at a time. Both feed
 * `resolveProviderPathWith`, and both MUST land on the same file for the same
 * specifier — a provider recorded under one path and looked up under another
 * silently costs the optimization. One predicate, so they cannot drift.
 *
 * Kept out of `cross-module-registry` on purpose: that module stays free of
 * filesystem access so its probing rules remain unit-testable without a build.
 *
 * @module provider-file
 */

import { existsSync, statSync } from 'node:fs';

/**
 * Whether one candidate path is a file that may be read as a provider.
 *
 * @param candidate - Path produced by the probe list.
 * @returns True when it is a readable regular file.
 */
export function isReadableProviderFile(candidate: string): boolean {
    try {
        return existsSync(candidate) && statSync(candidate).isFile();
    } catch {
        return false;
    }
}
