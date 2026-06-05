import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const dependencyPath = fileURLToPath(
    new URL('../../../playground/nextjs-16/loaders/dependency-probe.txt', import.meta.url),
);

test.describe('Next.js 16 Turbopack addDependency Probe', () => {
    test.beforeEach(async () => {
        await writeFile(dependencyPath, 'dep-a\n');
    });

    test.afterEach(async () => {
        await writeFile(dependencyPath, 'dep-a\n');
    });

    test('invalidates loader output when an external dependency changes', async ({ page }) => {
        await page.goto('/turbo-dependency-probe');

        const probe = page.getByTestId('turbo-dependency-probe');
        await expect(probe).toHaveText('dep-a');

        await writeFile(dependencyPath, 'dep-b\n');

        await expect
            .poll(async () => {
                await page.reload();
                return probe.textContent();
            })
            .toBe('dep-b');
    });
});
