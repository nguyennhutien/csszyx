import { defineConfig } from 'vitest/config';

// This package's suites are standalone node scripts (they drive a real
// tsserver and a packed tarball) run by the package `test` script, NOT vitest
// tests — but their *.test.mjs names match vitest's default include, so the
// root `projects: ['packages/*']` glob was collecting and failing all of them
// inside every root vitest run. Declare an empty include so the project
// participates without collecting anything; coverage for this package comes
// from the c8 lcov produced by `test:coverage`.
export default defineConfig({
    test: {
        include: [],
        passWithNoTests: true,
    },
});
