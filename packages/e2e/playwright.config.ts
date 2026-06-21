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
            name: 'dynamic',
            testMatch: /dynamic\.spec/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:5173',
            },
        },
        {
            name: 'react17',
            testMatch: /react17/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:5174',
            },
        },
        {
            // Reuses the vite-react dev server (port 5173) — fixture lives in
            // playground/vite-react/src/Recovery.tsx, mounted at ?page=recovery.
            name: 'recovery-manifest',
            testMatch: /recovery-manifest\.spec/,
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
            name: 'nextjs-16-webpack',
            testMatch: /nextjs-16-webpack/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3017',
            },
        },
        {
            name: 'nextjs-16-tailwind-source',
            testMatch: /nextjs-16-tailwind-source/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3018',
            },
        },
        {
            name: 'nextjs-16-turbo-loader',
            testMatch: /nextjs-16-turbo-loader/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3018',
            },
        },
        {
            name: 'nextjs-16-turbo-add-dependency',
            testMatch: /nextjs-16-turbo-add-dependency/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3018',
            },
        },
        {
            name: 'nextjs-16-turbo-csszyx-loader',
            testMatch: /nextjs-16-turbo-csszyx-loader/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3018',
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
        {
            name: 'vanilla-html',
            testMatch: /vanilla-html/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:5179',
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
            command: 'pnpm run dev -- --port 5174 --strictPort',
            cwd: '../../playground/react17',
            url: 'http://localhost:5174',
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
        {
            command: 'pnpm run build && pnpm run start',
            cwd: '../../playground/nextjs-16',
            url: 'http://localhost:3017',
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 120000,
        },
        {
            command: 'pnpm run dev:turbo',
            cwd: '../../playground/nextjs-16',
            url: 'http://localhost:3018/tailwind-source',
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 120000,
        },
        {
            // Vanilla HTML serves the IIFE bundle copied from csszyx package by
            // the playground's predev hook, so this implicitly verifies the
            // package→playground copy chain too.
            command: 'pnpm run dev --port 5179 --strictPort',
            cwd: '../../playground/vanilla-html',
            url: 'http://localhost:5179',
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
        },
    ],
});
