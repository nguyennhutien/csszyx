import { defineConfig } from 'vitest/config';

// Vitest 4 replaces `defineWorkspace`/`vitest.workspace.ts` with the
// `test.projects` field in a root vitest.config.ts. Each entry can be a
// glob path pointing at a package directory containing its own
// vitest.config.ts, or an inline project config object.
//
// Add new packages here when they ship tests. Order is not significant.
export default defineConfig({
    test: {
        projects: [
            'packages/compiler',
            'packages/runtime',
            'packages/unplugin',
            'packages/core',
            'packages/cli',
            'packages/vscode',
        ],
    },
});
