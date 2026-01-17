import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    webServer: {
        command: 'pnpm --filter @csszyx/playground-nextjs-ssr start -p 3002',
        port: 3002,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
    },
    use: {
        baseURL: 'http://localhost:3002',
        headless: true,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
});
