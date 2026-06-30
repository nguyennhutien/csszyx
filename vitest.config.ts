import { defineConfig } from 'vitest/config';

// Vitest 4 replaces `defineWorkspace`/`vitest.workspace.ts` with the
// `test.projects` field. The `packages/*` glob auto-picks up every
// workspace package that ships its own vitest.config.ts — packages
// without a config are skipped silently, so no maintenance is needed
// when adding new packages.
//
// Each package needs its own vitest.config.ts (even a minimal one) so
// per-package `pnpm test` resolves locally instead of walking up to
// this root config — Vitest 4 mis-resolves `projects` entries relative
// to the package CWD when invoked from a sub-directory.
export default defineConfig({
    test: {
        projects: ['packages/*'],
        // Coverage only activates with `--coverage` (the `test:coverage`
        // script), so normal `pnpm test` runs are unaffected and need no
        // extra dependency. Running it requires `@vitest/coverage-v8`
        // (install once on the host: `pnpm add -D @vitest/coverage-v8 -w`).
        // The 80% thresholds are the OpenSSF gold target; lower them only
        // with a recorded reason.
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['packages/*/src/**/*.{ts,tsx}'],
            exclude: [
                '**/*.d.ts',
                '**/dist/**',
                '**/tests/**',
                '**/*.test.ts',
                '**/scripts/**',
                'packages/e2e/**',
            ],
            thresholds: {
                statements: 80,
                branches: 80,
                functions: 80,
                lines: 80,
            },
        },
    },
});
