import { expect, test } from '@playwright/test';

test.describe('Next.js 16 Turbopack Loader Probe', () => {
    test('applies a webpack-compatible loader through turbopack.rules', async ({ page }) => {
        await page.goto('/turbo-loader-probe');

        const probe = page.getByTestId('turbo-loader-probe');
        await expect(probe).toBeVisible();
        await expect(probe).toHaveText('probe-ok');
        await expect(probe).not.toHaveText('__CSSZYX_TURBO_LOADER_PROBE__');
    });
});
