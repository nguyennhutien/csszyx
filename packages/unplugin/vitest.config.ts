import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        // These suites drive the real plugin: they read playground and docs
        // sources off disk, dynamically import built entries, and push them
        // through the native transform. That is bounded work, but it scales
        // with machine load, and under a full parallel run several tests
        // crossed vitest's 5s default and failed as timeouts — which read as
        // flaky engine bugs rather than a budget that was simply too tight.
        // Raised here rather than per test, so a new suite of the same shape
        // does not have to rediscover it.
        testTimeout: 30_000,
    },
});
