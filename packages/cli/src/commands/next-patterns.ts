import {
    DEPENDENCY_OUTPUT_DIRS,
    SOURCE_MODULE_EXTENSIONS,
    skippedDirGlobs,
} from '@csszyx/tailwind-oracle';

/**
 * Default Next source glob shared by prebuild and watch commands: every module
 * flavour the build lowers, under the folders a Next app keeps its code in.
 */
export const DEFAULT_NEXT_SOURCE_PATTERN = `{app,pages,src}/**/*.{${SOURCE_MODULE_EXTENSIONS.map(
    extension => extension.slice(1),
).join(',')}}`;

/**
 * Build/cache paths excluded from Next source discovery, at the app root only.
 * Gitignored sources are still read: they build the safelist shards.
 */
export const DEFAULT_NEXT_SOURCE_IGNORE: readonly string[] = [
    ...skippedDirGlobs(DEPENDENCY_OUTPUT_DIRS, { anchored: true }),
    '.next-turbo-*/**',
    '.csszyx/**',
];
