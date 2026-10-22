import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        // Colour on everywhere, as on a CI runner: GitHub Actions sets `CI`,
        // and picocolors colours output whenever `CI` is set, TTY or not. A
        // local run has neither, so a test that pinned a printed line passed
        // here and failed in CI on the colour codes. Pinned on, a test that
        // forgets to strip them fails on the machine that wrote it.
        env: { FORCE_COLOR: '1' },
    },
});
