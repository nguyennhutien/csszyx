import { expect, test } from '@playwright/test';

test.describe('Next.js 16 Webpack Playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('renders the Next.js 16 compatibility playground', async ({ page }) => {
        await expect(
            page.getByRole('heading', { name: 'csszyx Next.js 16 Playground' }),
        ).toBeVisible();
        await expect(page.getByText('Next.js 16 Webpack mode')).toBeVisible();
    });

    test('transforms sz props and keeps production hydration metadata', async ({ page }) => {
        const card = page.getByTestId('next16-card');
        await expect(card).toBeVisible();

        await expect(card).not.toHaveAttribute('sz', /./);

        const className = await card.getAttribute('class');
        expect(className).toBeTruthy();
        expect(className).not.toContain('p-6');
        expect(className).not.toContain('bg-blue-50');

        const styles = await card.evaluate(element => {
            const computed = getComputedStyle(element);
            return {
                paddingTop: computed.paddingTop,
                backgroundColor: computed.backgroundColor,
                borderTopWidth: computed.borderTopWidth,
            };
        });

        expect(Number.parseFloat(styles.paddingTop)).toBeGreaterThan(0);
        expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
        expect(Number.parseFloat(styles.borderTopWidth)).toBeGreaterThan(0);

        const checksum = await page.locator('html').getAttribute('data-sz-checksum');
        expect(checksum).toBeTruthy();
        expect(checksum).toHaveLength(16);
    });
});
