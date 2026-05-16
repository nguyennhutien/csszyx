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
    },
});
