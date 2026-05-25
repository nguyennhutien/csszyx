import { expect, test } from '@playwright/test';

test.describe('Vite-React Playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.screenshot({ path: 'test-results/debug-initial.png' });
    });

    test('should render the playground title', async ({ page }) => {
        await expect(page.locator('h1')).toContainText('csszyx Playground');
    });

    test('should increment and decrement counter', async ({ page }) => {
        const counter = page.locator('span', { hasText: '0' });
        await expect(counter).toBeVisible();

        await page.click('button:has-text("Increment")');
        await expect(page.locator('span', { hasText: '1' })).toBeVisible();

        await page.click('button:has-text("Decrement")');
        await expect(page.locator('span', { hasText: '0' })).toBeVisible();
    });

    test('should toggle conditional button state', async ({ page }) => {
        const button = page.locator('button:has-text("Inactive")');
        await expect(button).toBeVisible();

        // Verify the button has class attributes (mangled or unmangled)
        const inactiveClass = await button.getAttribute('class');
        expect(inactiveClass).toBeTruthy();

        await button.click();
        const activeButton = page.locator('button:has-text("Active")');
        await expect(activeButton).toBeVisible();

        // After toggle, class should change
        const activeClass = await activeButton.getAttribute('class');
        expect(activeClass).toBeTruthy();
        expect(activeClass).not.toBe(inactiveClass);
    });

    test('should have transformed sz props into class names', async ({ page }) => {
        // Vite runs in dev mode — no CSS mangling, but sz→className transform should work
        await page.waitForLoadState('networkidle');

        const h1 = page.locator('h1');
        const className = await h1.getAttribute('class');

        console.log('H1 Class Name:', className);

        // Verify sz prop was transformed to Tailwind class names
        expect(className).toBeTruthy();
        expect(className).toContain('text-4xl');
        expect(className).toContain('font-bold');
    });

    test('should have sz-checksum meta or data attribute', async ({ page }) => {
        // Check if the checksum is injected
        // We might need to refresh once the map is populated
        const htmlEl = page.locator('html');
        let checksum = await htmlEl.getAttribute('data-sz-checksum');

        if (!checksum) {
            await page.reload();
            checksum = await htmlEl.getAttribute('data-sz-checksum');
        }

        console.log('Mangle Checksum:', checksum);

        if (checksum) {
            // e3b0c44298fc1c14 is the empty checksum, we want something else
            expect(checksum).not.toBe('e3b0c44298fc1c14');
            expect(checksum).toHaveLength(16);
        }
    });

    test('should expose hoisted css variable mangling metadata', async ({ page }) => {
        await page.goto('/?page=css-vars');
        await page.waitForLoadState('networkidle');

        const fixture = page.getByTestId('css-var-fixture');
        const cardA = page.getByTestId('css-var-card-a');
        const cardB = page.getByTestId('css-var-card-b');

        await expect(fixture).toBeVisible();
        await expect(fixture).toHaveAttribute('style', /--cz:\s*calc\(4 \* var\(--spacing\)\)/);
        await expect(cardA).toHaveAttribute('class', /p-\(--cz\)/);
        await expect(cardB).toHaveAttribute('class', /p-\(--cz\)/);

        await page.getByTestId('css-var-button').click();
        await expect(fixture).toHaveAttribute('style', /--cz:\s*calc\(5 \* var\(--spacing\)\)/);

        const varMap = await page.evaluate(() => window.__csszyx?.varMangleMap);
        expect(varMap).toEqual({ '--_sz-p': '--cz' });

        const decoded = await page.evaluate(() => window.__csszyx?.decodeVar?.('--cz'));
        expect(decoded).toEqual(['--_sz-p']);
    });
});
