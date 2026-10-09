import { DEPENDENCY_OUTPUT_DIRS, skippedDirGlobs } from '@csszyx/tailwind-oracle';

/** Default Next source glob shared by prebuild and watch commands. */
export const DEFAULT_NEXT_SOURCE_PATTERN = '{app,pages,src}/**/*.{ts,tsx,js,jsx,mjs,cjs}';

/**
 * Build/cache paths excluded from Next source discovery, at the app root only.
 * Gitignored sources are still read: they build the safelist shards.
 */
export const DEFAULT_NEXT_SOURCE_IGNORE: readonly string[] = [
    ...skippedDirGlobs(DEPENDENCY_OUTPUT_DIRS, { anchored: true }),
    '.next-turbo-*/**',
    '.csszyx/**',
];
