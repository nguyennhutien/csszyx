/** The csszyx entries whose code decides what a transformed module becomes. */
const CSSZYX_ENTRIES = ['@csszyx/compiler', '@csszyx/core', '@csszyx/core/native'] as const;

/**
 * The files webpack's persistent cache must depend on for csszyx: the module
 * that runs the transform, and each csszyx entry that resolves beside it.
 *
 * A module webpack restores from the cache is not transformed again, and
 * Next.js keys its cache on Next and `next.config` only, so a csszyx upgrade
 * replayed the classes the previous csszyx wrote. Listed under
 * `cache.buildDependencies`, these make webpack drop the cache when one
 * changes: by package version under `node_modules`, by content in a
 * workspace.
 *
 * @param self - The path of the module that runs the transform.
 * @param resolve - Resolves a package specifier from that module.
 * @returns The files, `self` first; an entry that does not resolve is left out.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function csszyxCacheDependencies(
    self: string,
    resolve: (specifier: string) => string,
): string[] {
    const files = [self];
    for (const specifier of CSSZYX_ENTRIES) {
        try {
            files.push(resolve(specifier));
        } catch {
            // Not installed beside this copy: nothing of it to depend on.
        }
    }
    return files;
}

/**
 * The cache version with csszyx's own versions after it.
 *
 * webpack compares only the build dependencies a stored cache recorded, so a
 * cache written before csszyx listed its files would be read once more after
 * the upgrade that adds them. The version is compared whatever the cache
 * holds, so a changed csszyx release always starts a new cache.
 *
 * @param version - The version the cache had, if any (Next.js sets one).
 * @param csszyx - The csszyx versions.
 * @param csszyx.plugin - The version of `@csszyx/unplugin`.
 * @param csszyx.compiler - The version of `@csszyx/compiler`.
 * @returns The version to use.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export function csszyxCacheVersion(
    version: string | undefined,
    csszyx: { plugin: string; compiler: string },
): string {
    const own = `csszyx@${csszyx.plugin}+compiler@${csszyx.compiler}`;
    return version ? `${version}|${own}` : own;
}
