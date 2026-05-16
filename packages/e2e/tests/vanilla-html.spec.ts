/**
 * E2E tests for csszyx browser IIFE runtime (`csszyx/browser`).
 *
 * Why it needs its own e2e:
 *   - The IIFE bundle ships its own string→object parser (`parseSzAttribute`)
 *     that lives ONLY in this runtime — compiler unit tests don't cover it.
 *   - It's a public CDN distribution (unpkg/jsdelivr fields in csszyx
 *     package.json), so a regression here hits external users directly.
 *   - The MutationObserver path is easy to break silently.
 *
 * Setup:
 *   - playground/vanilla-html serves index.html via vite (port 5179, set in
 *     playwright.config.ts webServer entry).
 *   - The page's <script src="./csszyx.js"> loads the IIFE bundle copied from
 *     csszyx package's dist by the playground predev hook.
 */

import { expect, test } from '@playwright/test';

declare global {
    /**
     *
     */
    interface Window {
        __SZ_MANGLE_MAP__?: Record<string, string>;
    }
}

test.describe('csszyx/browser — vanilla HTML IIFE runtime', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // The runtime adds .sz-ready to <body> after the initial DOM walk.
        // Waiting on this avoids racing the bundle's DOMContentLoaded handler.
        await page.locator('body.sz-ready').waitFor({ timeout: 5000 });
    });

    test('processes static sz attributes into Tailwind class names and removes the sz attribute', async ({
        page,
    }) => {
        const body = page.locator('body');
        const cls = (await body.getAttribute('class')) ?? '';

        // From index.html: <body sz="{ bg: 'slate-950', color: 'slate-200', minH: 'screen', fontFamily: 'sans', p: 8 }">
        expect(cls).toContain('bg-slate-950');
        expect(cls).toContain('text-slate-200');
        expect(cls).toContain('p-8');

        // Cleanup contract: sz attribute is removed after compilation.
        expect(await body.getAttribute('sz')).toBeNull();
    });

    test('parser accepts implicit syntax (no outer braces)', async ({ page }) => {
        await page.evaluate(() => {
            const div = document.createElement('div');
            div.id = 'implicit-test';
            // No outer { } — auto-wrap branch in parseSzAttribute.
            div.setAttribute('sz', "p: 4, bg: 'red-500', color: 'white'");
            document.body.appendChild(div);
        });

        await page.waitForFunction(
            () => document.getElementById('implicit-test')?.classList.contains('p-4'),
            { timeout: 2000 },
        );

        const cls = (await page.locator('#implicit-test').getAttribute('class')) ?? '';
        expect(cls).toContain('p-4');
        expect(cls).toContain('bg-red-500');
        expect(cls).toContain('text-white');
    });

    test('MutationObserver picks up dynamically added elements with object syntax', async ({
        page,
    }) => {
        await page.evaluate(() => {
            const div = document.createElement('div');
            div.id = 'observer-test';
            div.setAttribute('sz', "{ m: 6, rounded: 'lg', bg: 'emerald-500' }");
            document.body.appendChild(div);
        });

        await page.waitForFunction(
            () => document.getElementById('observer-test')?.classList.contains('m-6'),
            { timeout: 2000 },
        );

        const cls = (await page.locator('#observer-test').getAttribute('class')) ?? '';
        expect(cls).toContain('m-6');
        expect(cls).toContain('rounded-lg');
        expect(cls).toContain('bg-emerald-500');
    });

    test('processes nested elements added in a subtree (processSubtree path)', async ({ page }) => {
        // Insert a parent with sz AND children with sz — observer dispatches the
        // root, processSubtree must recurse into descendants.
        await page.evaluate(() => {
            const wrapper = document.createElement('section');
            wrapper.id = 'subtree-parent';
            wrapper.setAttribute('sz', '{ p: 2 }');
            wrapper.innerHTML =
                '<span id="subtree-child" sz="{ color: \'pink-400\' }">child</span>';
            document.body.appendChild(wrapper);
        });

        await page.waitForFunction(
            () => document.getElementById('subtree-child')?.classList.contains('text-pink-400'),
            { timeout: 2000 },
        );

        const parentCls = (await page.locator('#subtree-parent').getAttribute('class')) ?? '';
        const childCls = (await page.locator('#subtree-child').getAttribute('class')) ?? '';
        expect(parentCls).toContain('p-2');
        expect(childCls).toContain('text-pink-400');
    });
});
