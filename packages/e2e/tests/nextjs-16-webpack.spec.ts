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

    test('compiles a style object imported through the tsconfig alias', async ({ page }) => {
        // Next maps `@/*` with a resolver plugin, so the alias table webpack
        // hands its plugins says nothing about it — csszyx has to read
        // tsconfig to resolve the provider. A real Next build is the only
        // place that arrangement exists as itself rather than as a fixture.
        await page.goto('/alias-import');
        const card = page.getByTestId('alias-card');
        await expect(card).toBeVisible();

        // The class is present either way: the runtime fallback applies it too.
        // What separates compiled from fallen-back is whether anything told
        // Tailwind the class exists, and that shows up as the rule itself.
        const styles = await card.evaluate(element => {
            const computed = getComputedStyle(element);
            return { paddingTop: computed.paddingTop, letterSpacing: computed.letterSpacing };
        });

        expect(Number.parseFloat(styles.paddingTop)).toBeGreaterThan(0);
        expect(styles.letterSpacing).not.toBe('normal');
    });
});
