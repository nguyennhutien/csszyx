/**
 * The production build under an ENFORCED Content-Security-Policy.
 *
 * Field report: a consumer enforcing `script-src 'self'` found an executable
 * inline `window.__csszyx` installer in its built index.html — the browser
 * refused it, and had the app relied on it, runtime-resolved classes would
 * have reached the DOM unmangled while the CSS shipped mangled. This project
 * serves the real `vite build` output through `vite preview` with the policy
 * in the response header, and fails on any violation the browser reports.
 */
import { expect, type Page, test } from '@playwright/test';

/** What the page recorded before any test-side code ran. */
interface CspObservations {
    violations: string[];
    consoleErrors: string[];
}

/**
 * Arm the page: `securitypolicyviolation` is dispatched on `document` for
 * every refused resource, and it fires before the app's own modules, so the
 * listener must be installed by an init script rather than after `goto`.
 *
 * @param page - The page under test.
 * @returns A collector of what the browser refused.
 */
async function observeCsp(page: Page): Promise<() => Promise<CspObservations>> {
    const consoleErrors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.addInitScript(() => {
        const violations: string[] = [];
        (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
        document.addEventListener('securitypolicyviolation', event => {
            violations.push(`${event.violatedDirective} ${event.blockedURI} ${event.sample}`);
        });
    });
    return async () => ({
        violations: await page.evaluate(
            () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
        ),
        consoleErrors,
    });
}

test.describe('production build under script-src self', () => {
    test('the response carries the enforced policy', async ({ page }) => {
        const response = await page.goto('/');
        expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
    });

    test('the browser reports no violation and csszyx installs nothing inline', async ({
        page,
    }) => {
        const observe = await observeCsp(page);
        await page.goto('/?page=szv');
        // The element is the signal, not the network: a refused script fires
        // its violation before the app renders, and waiting on an idle network
        // waits on whatever else the page happens to fetch.
        await expect(page.getByTestId('szv-standalone')).toBeVisible();

        const { violations, consoleErrors } = await observe();
        expect(violations).toEqual([]);
        expect(consoleErrors.filter(text => /Content Security Policy/i.test(text))).toEqual([]);

        // Every inline <script> csszyx emits is a JSON data block.
        const inlineScripts = await page.evaluate(() =>
            [...document.querySelectorAll('script:not([src])')].map(
                script => script.getAttribute('type') ?? '',
            ),
        );
        for (const type of inlineScripts) expect(type).toBe('application/json');
        expect(
            await page.evaluate(() => (window as Record<string, unknown>).__csszyx),
        ).toBeUndefined();
    });

    test('runtime-resolved classes are mangled and still styled', async ({ page }) => {
        // `SzvStandalone` has no `sz=` at all: its classes come from
        // `szr(szv(...))` at render time, so they only match the mangled CSS if
        // the map was registered — from the bundle, since the HTML has no
        // executable script to do it.
        await page.goto('/?page=szv');
        const element = page.getByTestId('szv-arbitrary');
        await expect(element).toBeVisible();

        const report = await element.evaluate(node => {
            const tokens = (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
            // Tailwind v4 nests utilities under `@layer` (and variants under
            // `@media`), so walk grouping rules rather than the top level only.
            const selectors: string[] = [];
            const walk = (rules: CSSRuleList): void => {
                for (const rule of rules) {
                    if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText);
                    if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
                }
            };
            for (const sheet of document.styleSheets) walk(sheet.cssRules);
            const hasRule = (token: string): boolean => {
                const escaped = CSS.escape(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`(^|[^\\w-])\\.${escaped}(?![\\w-])`);
                return selectors.some(selector => pattern.test(selector));
            };
            return { tokens, unmatched: tokens.filter(token => !hasRule(token)) };
        });
        expect(report.tokens.length).toBeGreaterThan(0);
        // Mangled: no arbitrary-value class survives in its original form…
        expect(report.tokens.filter(token => token.includes('['))).toEqual([]);
        // …and every token the runtime produced has a rule in the shipped CSS.
        expect(report.unmatched).toEqual([]);
    });
});
