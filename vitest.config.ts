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
        projects: ['packages/*', '!packages/e2e'],
        // Coverage only activates with `--coverage` (the `test:coverage`
        // script), so normal `pnpm test` runs are unaffected. This measures
        // the TypeScript/JS packages only — the native Rust engine
        // (packages/core/src/transform/*.rs) is invisible to V8 coverage and
        // is measured separately with `cargo llvm-cov`.
        //
        // OpenSSF coverage targets: Silver = statements >=80%; Gold =
        // statements >=90% AND branches >=80%. Today's TS numbers are below
        // Silver (statements ~76% / branches ~71%), so the thresholds below
        // are a no-regression ratchet floor, not the target — raise them
        // toward 80% as the interactive CLI package gains coverage.
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            // Still emit the coverage report when a test fails (e.g. a flaky
            // timing test under instrumentation load) so the numbers are visible.
            reportOnFailure: true,
            include: ['packages/*/src/**/*.{ts,tsx}'],
            exclude: [
                '**/*.d.ts',
                '**/dist/**',
                '**/tests/**',
                '**/*.test.ts',
                '**/*.type-test.ts', // type-only assertions, no runtime to cover
                '**/scripts/**',
                'packages/e2e/**',
            ],
            // Ratchet floor — keeps coverage from regressing. Below the OpenSSF
            // gold target of 80% (statements 76% / branches 71% today); the gap
            // is concentrated in the interactive CLI package. Raise toward 80%
            // as CLI coverage grows, but never lower without a recorded reason.
            thresholds: {
                statements: 75,
                branches: 70,
                functions: 80,
                lines: 75,
            },
        },
    },
});
