import { expect, test } from '@playwright/test';

/**
 * React 17 smoke test. Guards that csszyx works on React 17 (mounted via
 * ReactDOM.render, not createRoot): the build-time sz->className transform and
 * the @csszyx/dynamic runtime hook must both work. Fixture:
 * playground/react17.
 */
test.describe('React 17 Playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('transforms static sz props into class names', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        const className = await page.locator('h1').getAttribute('class');
        expect(className).toBeTruthy();
        expect(className).toContain('text-4xl');
        expect(className).toContain('font-bold');
    });

    test('compiles a conditional sz branch on toggle', async ({ page }) => {
        const button = page.getByTestId('toggle');
        await expect(button).toHaveText('Inactive');
        const inactiveClass = await button.getAttribute('class');
        expect(inactiveClass).toBeTruthy();

        await button.click();
        await expect(button).toHaveText('Active');
        const activeClass = await button.getAttribute('class');
        expect(activeClass).toBeTruthy();
        expect(activeClass).not.toBe(inactiveClass);
    });

    test('runs the @csszyx/dynamic hook on React 17', async ({ page }) => {
        const card = page.getByTestId('dynamic-card');
        // useSz() returns a className from a runtime sz() call — proves the hook
        // package (useEffect/useContext under StrictMode) works on React 17.
        const initialClass = await card.getAttribute('class');
        expect(initialClass).toBeTruthy();
        const initialPadding = await card.evaluate(el => getComputedStyle(el).paddingTop);
        expect(Number.parseFloat(initialPadding)).toBeGreaterThan(0);

        await page.getByTestId('dynamic-button').click();
        await expect
            .poll(async () =>
                card.evaluate(el => Number.parseFloat(getComputedStyle(el).paddingTop)),
            )
            .toBeGreaterThan(Number.parseFloat(initialPadding));
    });
});
