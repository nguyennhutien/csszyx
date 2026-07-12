import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // applySzVars/patchSzVars touch element.style and the useSzVars hook
        // reads document.documentElement, so the suite needs a DOM.
        environment: 'jsdom',
        globals: true,
    },
});
