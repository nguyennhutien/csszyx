import { expect, test } from '@playwright/test';

test.describe('Next.js SSR Playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('should render the landing page', async ({ page }) => {
        await expect(page.locator('h1')).toContainText('csszyx Next.js SSR Playground');
    });

    test('should have mangled classes on server-rendered elements', async ({ page }) => {
        // Use .first() since there are multiple server-card elements
        const serverCard = page.locator('[data-testid="server-card"]').first();
        await expect(serverCard).toBeVisible();

        const className = await serverCard.getAttribute('class');
        console.log('Server Card Class:', className);

        // Should be mangled (tier-based names like z, y, x) or transformed
        expect(className).toBeTruthy();
        // Check that classes are short/mangled (not full Tailwind classes)
        expect(className?.split(' ').some(c => c.length <= 3)).toBe(true);
    });

    test('should hydrate correctly with client components', async ({ page }) => {
        const counter = page.locator('[data-testid="count-value"]');
        await expect(counter).toBeVisible();

        // Wait for hydration to complete
        await page.waitForTimeout(500);

        const countRaw = await counter.textContent();
        const count = parseInt(countRaw || '0', 10);

        // Click the Increase button
        await page.click('button:has-text("Increase")');

        // Wait for React state update
        await expect(counter).toHaveText(String(count + 1), { timeout: 5000 });
    });

    test('should have data-sz-checksum in HTML for hydration guard', async ({ page }) => {
        const html = page.locator('html');
        const checksum = await html.getAttribute('data-sz-checksum');

        console.log('Next.js Checksum:', checksum);
        expect(checksum).toBeTruthy();
        expect(checksum).toHaveLength(16);
    });
});
