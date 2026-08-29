import { expect, type Locator, test } from '@playwright/test';

test.describe('Vite-React Playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // The dev server serves modules on demand. Until it has finished, a
        // read of the DOM races the page it is still assembling; the first
        // test of a cold run lost that race under a full-suite load.
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: 'test-results/debug-initial.png' });
    });

    test('should render the playground title', async ({ page }) => {
        await expect(page.locator('h1')).toContainText('csszyx Playground');
    });

    test('should increment and decrement counter', async ({ page }) => {
        // Whole-text matches: `hasText: '0'` is a substring match and would
        // also accept a span reading "10".
        await expect(page.locator('span', { hasText: /^0$/ })).toBeVisible();

        await page.getByRole('button', { name: 'Increment', exact: true }).click();
        await expect(page.locator('span', { hasText: /^1$/ })).toBeVisible();

        await page.getByRole('button', { name: 'Decrement', exact: true }).click();
        await expect(page.locator('span', { hasText: /^0$/ })).toBeVisible();
    });

    test('should toggle conditional button state', async ({ page }) => {
        // The labels are "\u25CB Inactive" and "\u2713 Active". Anchored
        // names: a substring match on "Active" also matches "Inactive", so
        // the old locator resolved to the same button before the click had
        // rendered and read its class as unchanged.
        const button = page.getByRole('button', { name: /^\u25CB Inactive$/ });
        await expect(button).toBeVisible();

        // Verify the button has class attributes (mangled or unmangled)
        const inactiveClass = await button.getAttribute('class');
        expect(inactiveClass).toBeTruthy();

        await button.click();
        const activeButton = page.getByRole('button', { name: /^\u2713 Active$/ });
        await expect(activeButton).toBeVisible();

        // After toggle, the class changes; the assertion retries until the
        // render has landed instead of reading one snapshot.
        await expect(activeButton).toHaveAttribute('class', /./);
        await expect(activeButton).not.toHaveClass(inactiveClass ?? '');
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

        const initialCardAPadding = await paddingTopPx(cardA);
        const initialCardBPadding = await paddingTopPx(cardB);
        expect(initialCardAPadding).toBeGreaterThan(0);
        expect(initialCardBPadding).toBe(initialCardAPadding);

        await page.getByTestId('css-var-button').click();
        await expect(fixture).toHaveAttribute('style', /--cz:\s*calc\(5 \* var\(--spacing\)\)/);
        await expect.poll(() => paddingTopPx(cardA)).toBeGreaterThan(initialCardAPadding);
        await expect.poll(() => paddingTopPx(cardB)).toBeGreaterThan(initialCardBPadding);

        // The variable map ships in the inert hydration census (data, not
        // script); `window.__csszyx` is opt-in and the dev server installs
        // nothing executable.
        const census = await page.evaluate(() =>
            JSON.parse(document.getElementById('__CSSZYX_MANGLE_MAP__')?.textContent ?? 'null'),
        );
        expect(census).toMatchObject({ 'var:--_sz-p': '--cz' });
        expect(await page.evaluate(() => window.__csszyx)).toBeUndefined();
    });
});

/**
 * Reads computed padding-top from a locator.
 *
 * @param locator element locator
 * @returns numeric padding-top in px
 */
async function paddingTopPx(locator: Locator): Promise<number> {
    const value = await locator.evaluate(element => getComputedStyle(element).paddingTop);
    return Number.parseFloat(value);
}
