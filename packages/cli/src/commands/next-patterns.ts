/** Default Next source glob shared by prebuild and watch commands. */
export const DEFAULT_NEXT_SOURCE_PATTERN = '{app,pages,src}/**/*.{ts,tsx,js,jsx,mjs,cjs}';

/** Build/cache paths excluded from Next source discovery. */
export const DEFAULT_NEXT_SOURCE_IGNORE = [
    'node_modules/**',
    '.git/**',
    '.next/**',
    '.next-turbo-*/**',
    '.csszyx/**',
    'dist/**',
    'build/**',
] as const;
