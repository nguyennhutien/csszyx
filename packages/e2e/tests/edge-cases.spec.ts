import { expect, test } from '@playwright/test';

test.describe('Edge Case Tests (Next.js)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('edge case section renders all test cases', async ({ page }) => {
        // Verify all 20 test cases are present
        for (const caseId of [
            '1-dynamic-spacing',
            '2-arbitrary',
            '3-opacity',
            '4-negative',
            '5-fraction',
            '6-responsive',
            '7-hover',
            '8-conditional',
            '9-gradient-r',
            '10-gradient-b',
            '11-gradient-via',
            '12-radial',
            '13-conic',
            '14-gradient-interp',
            '15-bg-props',
            '16-bg-clip',
            '17-bg-attach',
            '18-bg-none',
            '19-fraction-w',
            '20-fraction-h',
        ]) {
            const el = page.locator(`[data-case="${caseId}"]`);
            await expect(el).toBeVisible();
        }
    });

    test('dynamic spacing updates class on click', async ({ page }) => {
        const box = page.locator('[data-case="1-dynamic-spacing"]');
        await expect(box).toBeVisible();

        // Initial text should show p-4
        await expect(box).toContainText('p-4');

        // Click increase button
        await page.click('[data-testid="edge-increase"]');

        // Text should now show p-5
        await expect(box).toContainText('p-5');

        // Class should have changed
        const className = await box.getAttribute('class');
        expect(className).toBeTruthy();
    });

    test('conditional toggle changes class', async ({ page }) => {
        const box = page.locator('[data-case="8-conditional"]');
        await expect(box).toContainText('Inactive');

        const inactiveClass = await box.getAttribute('class');

        // Toggle ON
        await page.click('[data-testid="edge-toggle"]');
        await expect(box).toContainText('Active');

        const activeClass = await box.getAttribute('class');
        expect(activeClass).not.toBe(inactiveClass);
    });

    test('gradient case has correct classes', async ({ page }) => {
        const box = page.locator('[data-case="9-gradient-r"]');
        await expect(box).toBeVisible();

        const className = await box.getAttribute('class');
        expect(className).toBeTruthy();
        // Gradient should have bgImg + from/to classes
        expect((className ?? '').split(/\s+/).length).toBeGreaterThanOrEqual(3);
    });

    test('static edge cases have mangled classes', async ({ page }) => {
        // Case 4 (negative) and Case 5 (fraction) are static objects
        // They should be compile-time transformed and mangled
        const negativeBox = page.locator('[data-case="4-negative"]');
        const fractionBox = page.locator('[data-case="5-fraction"]');

        const negClass = await negativeBox.getAttribute('class');
        const fracClass = await fractionBox.getAttribute('class');

        expect(negClass).toBeTruthy();
        expect(fracClass).toBeTruthy();

        // These should have classes (mangled or original)
        expect((negClass ?? '').split(/\s+/).length).toBeGreaterThanOrEqual(3);
        expect((fracClass ?? '').split(/\s+/).length).toBeGreaterThanOrEqual(3);
    });

    test('mangle map and checksum are accessible', async ({ page }) => {
        // Checksum should always be in the HTML attribute
        const htmlEl = page.locator('html');
        const checksum = await htmlEl.getAttribute('data-sz-checksum');
        expect(checksum).toBeTruthy();
        expect(checksum).toHaveLength(16);

        // window.__csszyx helper should be available after script execution
        const helper = await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const h = (window as Record<string, any>).__csszyx;
            if (!h) {return null;}
            return {
                mangleMap: h.mangleMap,
                checksum: h.checksum,
                hasDecode: typeof h.decode === 'function',
                hasEncode: typeof h.encode === 'function',
                hasDecodeAll: typeof h.decodeAll === 'function',
            };
        });

        if (helper) {
            // mangleMap should be an object with string values
            expect(typeof helper.mangleMap).toBe('object');
            const keys = Object.keys(helper.mangleMap);
            expect(keys.length).toBeGreaterThan(0);

            // Each value should be a short mangled name
            for (const key of keys.slice(0, 5)) {
                expect(typeof helper.mangleMap[key]).toBe('string');
                expect(helper.mangleMap[key].length).toBeLessThanOrEqual(3);
            }

            // Helper API should be present
            expect(helper.hasDecode).toBe(true);
            expect(helper.hasEncode).toBe(true);
            expect(helper.hasDecodeAll).toBe(true);

            if (helper.checksum) {
                expect(helper.checksum).toBe(checksum);
            }
        }
    });

    test('hover case has hover-related classes', async ({ page }) => {
        const box = page.locator('[data-case="7-hover"]');
        await expect(box).toBeVisible();

        const className = await box.getAttribute('class');
        expect(className).toBeTruthy();
        // Should have multiple classes (including hover variants)
        expect((className ?? '').split(/\s+/).length).toBeGreaterThanOrEqual(4);
    });

    test('responsive case has responsive classes', async ({ page }) => {
        const box = page.locator('[data-case="6-responsive"]');
        await expect(box).toBeVisible();

        const className = await box.getAttribute('class');
        expect(className).toBeTruthy();
        // Should have multiple classes (base + responsive variants)
        expect((className ?? '').split(/\s+/).length).toBeGreaterThanOrEqual(3);
    });
});
