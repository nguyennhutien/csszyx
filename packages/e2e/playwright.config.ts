import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    testDir: './tests',
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Opt out of parallel tests on CI. */
    workers: process.env.CI ? 1 : undefined,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: 'html',
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://127.0.0.1:3000',

        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'vite-react',
            testMatch: /vite-react/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:5173',
            },
        },
        {
            name: 'nextjs-ssr',
            testMatch: /nextjs-ssr/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3002',
            },
        },
        {
            name: 'edge-cases',
            testMatch: /edge-cases/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3002',
            },
        },
    ],

    /* Run your local dev server before starting the tests */
    webServer: [
        {
            command: 'pnpm run dev',
            cwd: '../../playground/vite-react',
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            command: 'pnpm run build && pnpm run start',
            cwd: '../../playground/nextjs-ssr',
            url: 'http://localhost:3002',
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 120000,
        },
    ],
});
