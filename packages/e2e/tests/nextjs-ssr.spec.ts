import { expect, type Locator, test } from '@playwright/test';

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

    test('should expose hoisted css variable mangling metadata', async ({ page }) => {
        const fixture = page.getByTestId('next-css-var-fixture');
        const cardA = page.getByTestId('next-css-var-card-a');
        const cardB = page.getByTestId('next-css-var-card-b');
        const scoped = page.getByTestId('next-css-var-scoped');

        await expect(fixture).toBeVisible();
        await expect(fixture).toHaveAttribute('style', /--cz:\s*calc\(4 \* var\(--spacing\)\)/);
        const encodedClass = await page.evaluate(() => window.__csszyx?.encode?.('p-(--cz)'));
        expect(encodedClass).toBeTruthy();
        const cardAClasses = (await cardA.getAttribute('class'))?.split(/\s+/) ?? [];
        const cardBClasses = (await cardB.getAttribute('class'))?.split(/\s+/) ?? [];
        expect(cardAClasses).toContain(encodedClass);
        expect(cardBClasses).toContain(encodedClass);

        const initialCardAPadding = await paddingTopPx(cardA);
        const initialCardBPadding = await paddingTopPx(cardB);
        expect(initialCardAPadding).toBeGreaterThan(0);
        expect(initialCardBPadding).toBe(initialCardAPadding);

        const encodedScopedClass = await page.evaluate(() => window.__csszyx?.encode?.('p-(--sz)'));
        expect(encodedScopedClass).toBeTruthy();
        const scopedClasses = (await scoped.getAttribute('class'))?.split(/\s+/) ?? [];
        expect(scopedClasses).toContain(encodedScopedClass);
        await expect(scoped).toHaveAttribute('style', /--sz:\s*calc\(5 \* var\(--spacing\)\)/);
        const initialScopedPadding = await paddingTopPx(scoped);
        expect(initialScopedPadding).toBeGreaterThan(initialCardAPadding);

        await page.getByTestId('next-css-var-button').click();
        await expect(fixture).toHaveAttribute('style', /--cz:\s*calc\(5 \* var\(--spacing\)\)/);
        await expect(scoped).toHaveAttribute('style', /--sz:\s*calc\(6 \* var\(--spacing\)\)/);
        await expect.poll(() => paddingTopPx(cardA)).toBeGreaterThan(initialCardAPadding);
        await expect.poll(() => paddingTopPx(cardB)).toBeGreaterThan(initialCardBPadding);
        await expect.poll(() => paddingTopPx(scoped)).toBeGreaterThan(initialScopedPadding);

        const varMap = await page.evaluate(() => window.__csszyx?.varMangleMap);
        expect(new Set(asArray(varMap?.['--_sz-p']))).toEqual(new Set(['--cz', '--sz']));

        const decoded = await page.evaluate(() => window.__csszyx?.decodeVar?.('--cz'));
        expect(decoded).toEqual(['--_sz-p']);
        const scopedDecoded = await page.evaluate(() => window.__csszyx?.decodeVar?.('--sz'));
        expect(scopedDecoded).toContain('--_sz-p');
    });
});

function asArray<T>(value: T | T[] | undefined): T[] {
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

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
