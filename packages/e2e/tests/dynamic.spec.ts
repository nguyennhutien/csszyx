/**
 * E2E tests for @csszyx/dynamic — runtime CSS injection.
 *
 * Strategy:
 *   - The playground is served in dev mode (vite dev server, port 5173).
 *   - In dev mode, csszyx-manifest.json does NOT exist → manifest fetch
 *     returns 404 → manifest.ts catches and falls back to empty Set.
 *   - All dynamic() calls therefore treat every class as "new" and inject
 *     CSS rules into document.adoptedStyleSheets.
 *   - Tests verify injection happened correctly and no rule is duplicated.
 */

import { expect, type Page, test } from '@playwright/test';

/**
 * Wait until the runtime has observably inserted at least one CSS rule.
 * @param page - Browser page hosting the dynamic fixture.
 */
async function waitForInjectedRules(page: Page): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate(() =>
                Array.from(document.adoptedStyleSheets).reduce(
                    (total, sheet) => total + sheet.cssRules.length,
                    0,
                ),
            ),
        )
        .toBeGreaterThan(0);
}

test.describe('@csszyx/dynamic — runtime injection', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/?page=dynamic');
        // Wait for the form container to appear
        await page.waitForSelector('[data-testid="dynamic-form-container"]');
    });

    test('renders all 20 form fields', async ({ page }) => {
        const form = page.locator('[data-testid="dynamic-form"]');
        await expect(form).toBeVisible();

        // All 20 inputs must be present
        const inputs = form.locator('input[type="text"]');
        await expect(inputs).toHaveCount(20);
    });

    test('every input has a className injected by dynamic()', async ({ page }) => {
        const inputs = page.locator('[data-testid="dynamic-form"] input[type="text"]');
        const count = await inputs.count();
        expect(count).toBe(20);

        for (let i = 0; i < count; i++) {
            const cls = await inputs.nth(i).getAttribute('class');
            // dynamic() must return a non-empty string
            expect(cls, `input[${i}] should have className`).toBeTruthy();
        }
    });

    test('CSS rules are injected into document.adoptedStyleSheets', async ({ page }) => {
        await waitForInjectedRules(page);

        const result = await page.evaluate(() => {
            const sheets = Array.from(document.adoptedStyleSheets);
            let totalRules = 0;
            for (const sheet of sheets) {
                totalRules += sheet.cssRules.length;
            }
            return { sheetsCount: sheets.length, totalRules };
        });

        // At least one tier sheet was created and rules were inserted
        expect(result.sheetsCount).toBeGreaterThan(0);
        expect(result.totalRules).toBeGreaterThan(0);
    });

    test('no duplicate CSS selectors across all adoptedStyleSheets', async ({ page }) => {
        await waitForInjectedRules(page);

        const { duplicates, allSelectors } = await page.evaluate(() => {
            // Collect every top-level rule text from all adopted sheets
            const rules: string[] = [];
            for (const sheet of Array.from(document.adoptedStyleSheets)) {
                for (const rule of Array.from(sheet.cssRules)) {
                    rules.push(rule.cssText);
                }
            }

            // Extract selector (text before first '{')
            const selectors = rules.map(r => r.split('{')[0].trim()).filter(Boolean);
            const seen = new Set<string>();
            const dupes: string[] = [];
            for (const sel of selectors) {
                if (seen.has(sel)) {
                    dupes.push(sel);
                } else {
                    seen.add(sel);
                }
            }
            return { duplicates: dupes, allSelectors: selectors };
        });

        expect(duplicates, `Duplicate selectors: ${duplicates.join(', ')}`).toHaveLength(0);
        // Sanity: at least some rules were collected
        expect(allSelectors.length).toBeGreaterThan(0);
    });

    test('re-rendering does not create new duplicate rules', async ({ page }) => {
        await waitForInjectedRules(page);

        const before = await page.evaluate(() => {
            let total = 0;
            for (const sheet of Array.from(document.adoptedStyleSheets)) {
                total += sheet.cssRules.length;
            }
            return total;
        });

        // Navigate away and back to trigger a second dynamic() run
        await page.goto('/');
        await page.goto('/?page=dynamic');
        await page.waitForSelector('[data-testid="dynamic-form-container"]');
        await waitForInjectedRules(page);

        const after = await page.evaluate(() => {
            let total = 0;
            for (const sheet of Array.from(document.adoptedStyleSheets)) {
                total += sheet.cssRules.length;
            }
            // Also verify no duplicates in fresh state
            const selectors: string[] = [];
            for (const sheet of Array.from(document.adoptedStyleSheets)) {
                for (const rule of Array.from(sheet.cssRules)) {
                    selectors.push(rule.cssText.split('{')[0].trim());
                }
            }
            const uniqueSelectors = new Set(selectors);
            return { total, hasDuplicates: selectors.length !== uniqueSelectors.size };
        });

        // After a clean navigation the injected Set resets → same rule count as first load
        expect(after.total).toBe(before);
        expect(after.hasDuplicates).toBe(false);
    });

    test('all 21 tier sheets are added to adoptedStyleSheets', async ({ page }) => {
        // @csszyx/dynamic initializes 21 sheets (one per Tier). The host may
        // already own adopted sheets, so wait for the observable lower bound.
        await expect
            .poll(() => page.evaluate(() => document.adoptedStyleSheets.length))
            .toBeGreaterThanOrEqual(21);
        const sheetCount = await page.evaluate(() => document.adoptedStyleSheets.length);
        expect(sheetCount).toBeGreaterThanOrEqual(21);
    });
});
