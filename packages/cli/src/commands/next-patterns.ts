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

/** The script extensions the Next commands lower, with their dot. */
export const NEXT_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(SOURCE_MODULE_EXTENSIONS);

/**
 * Build/cache paths excluded from Next source discovery, at the app root only.
 * The default glob also leaves out what `.gitignore` covers and takes back
 * what a stylesheet's `@source` names (`scanner/named-sources.ts`).
 */
export const DEFAULT_NEXT_SOURCE_IGNORE: readonly string[] = [
    ...skippedDirGlobs(DEPENDENCY_OUTPUT_DIRS, { anchored: true }),
    '.next-turbo-*/**',
    '.csszyx/**',
];
