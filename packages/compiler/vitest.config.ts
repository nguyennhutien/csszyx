import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            // The browser entries import the development reporter by the
            // package's own name, as an app resolves it (`tsdown.config.mjs`);
            // the suites run it from source, so a test never reads a stale
            // `dist`.
            '@csszyx/compiler/report': fileURLToPath(new URL('./src/report.ts', import.meta.url)),
        },
    },
    test: {
        globals: true,
        environment: 'node',
    },
});
