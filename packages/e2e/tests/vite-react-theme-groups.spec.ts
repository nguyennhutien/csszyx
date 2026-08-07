import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

/**
 * `szcn` theme groups after a `@theme` edit, in a real browser on Vite.
 *
 * A Vitest test drives the server half of this: it edits the stylesheet and
 * asks the dev server for the regenerated registration. What it cannot answer
 * is whether the PAGE ever re-runs that module — Vite has to propagate the
 * invalidation, and a module imported only for its side effect has no HMR
 * boundary of its own, so the update either reaches the page through a full
 * reload or not at all.
 *
 * That last hop is the whole question for someone editing a stylesheet, so it
 * is asserted here against the running dev server instead of being assumed.
 */
const stylesheetPath = fileURLToPath(
    new URL('../../../playground/vite-react/src/index.css', import.meta.url),
);

const LIVE_TOKEN = '--color-vite-live: #16a34a;';

test.describe
    .serial('Vite szcn theme groups', () => {
        let originalStylesheet = '';

        test.beforeAll(async () => {
            originalStylesheet = await readFile(stylesheetPath, 'utf8');
            if (!originalStylesheet.includes(LIVE_TOKEN)) {
                throw new Error(
                    `Token sentinel not found in ${stylesheetPath}. The declaration is part of ` +
                        'this integration contract; do not reflow or rename it.',
                );
            }
        });

        test.afterEach(async () => {
            await writeFile(stylesheetPath, originalStylesheet);
        });

        test('drops a token the stylesheet stops declaring, without a restart', async ({
            page,
        }) => {
            await page.goto('/?page=theme-groups');

            const merged = page.getByTestId('vite-theme-groups-merge');
            // Both are colour tokens the scan registered, so szcn knows they
            // conflict and keeps only the later one.
            await expect(merged).toHaveText('text-vite-live');

            await writeFile(stylesheetPath, originalStylesheet.replace(LIVE_TOKEN, ''));

            // `vite-live` is no longer a colour, so the two classes are no
            // longer known to conflict and both have to survive. No reload is
            // issued: whatever the dev server does to bring the page up to date
            // is exactly what a developer would get.
            await expect(merged).toHaveText('text-vite-base text-vite-live', {
                timeout: 30_000,
            });
        });
    });
