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

        /* Containers cap /dev/shm at 64MB by default; Chromium keeps its
         * renderer buffers there and dies with "Target crashed" once a few
         * pages run in parallel. Writing them to /tmp instead trades a little
         * speed for not crashing — same flag Playwright's own Docker docs
         * recommend. */
        launchOptions: {
            args: ['--disable-dev-shm-usage'],
        },
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
            // The production build of the same playground, served by `vite
            // preview` under an ENFORCED `script-src 'self'` policy.
            name: 'vite-react-csp',
            testMatch: /csp\.spec/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:5180',
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
            // The theme-group registration is a generated module the loader
            // writes, so this shares the Turbopack dev server the other
            // csszyx-loader specs use.
            name: 'nextjs-16-turbo-theme-groups',
            testMatch: /nextjs-16-turbo-theme-groups/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3018',
            },
        },
        {
            // Its own Turbopack dev server, over its own route, safelist and
            // Tailwind entry. It used to share the one above, and the sharing
            // was the whole problem: sibling specs rewrite that server's
            // `@source` files while the suite runs, and the regeneration this
            // chain ends in could not keep up with the churn. Nothing else
            // touches port 3021 or anything it reads.
            name: 'nextjs-16-turbo-cross-module',
            testMatch: /nextjs-16-turbo-cross-module/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3021',
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
            // Production build + preview: the only server here that enforces a
            // Content-Security-Policy header (see the playground's vite config).
            command: 'pnpm run build && pnpm run preview --port 5180 --strictPort',
            cwd: '../../playground/vite-react',
            url: 'http://localhost:5180',
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 120000,
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
            // The isolated cross-module lane: `csszyx next watch` scoped to one
            // route, writing a safelist only that route's stylesheet reads.
            command: 'pnpm run dev:xmod',
            cwd: '../../playground/nextjs-16',
            url: 'http://localhost:3021/turbo-xmod',
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
