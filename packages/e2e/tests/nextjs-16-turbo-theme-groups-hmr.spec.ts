import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

/**
 * `szcn` theme groups following a `@theme` edit on the Turbopack lane.
 *
 * Turbopack cannot resolve the virtual module every other bundler uses, so
 * csszyx writes the registration to a real file and imports it from the modules
 * that call `szcn`. The stylesheets are declared as loader dependencies, which
 * is what should make an edit regenerate that file mid-session.
 *
 * The loader-level tests cover the regeneration itself. What only a running
 * dev server can answer is whether Turbopack re-runs the loader at all — so
 * this edits the stylesheet and reads the merge result back out of the page.
 */
const stylesheetPath = fileURLToPath(
    new URL('../../../playground/nextjs-16/app/globals.css', import.meta.url),
);

const LIVE_TOKEN = '--color-csszyx-live: #16a34a;';

test.describe
    .serial('Next.js 16 Turbopack szcn theme groups', () => {
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
            await page.goto('/turbo-theme-groups');

            const merged = page.getByTestId('next16-theme-groups-merge');
            // Both are colour tokens, so szcn keeps only the later one.
            await expect(merged).toHaveText('text-csszyx-live');

            await writeFile(stylesheetPath, originalStylesheet.replace(LIVE_TOKEN, ''));

            // `csszyx-live` is no longer a colour, so the two classes are no
            // longer known to conflict and both have to survive. Reloading is
            // allowed here: the point is that the running dev server picks the
            // edit up at all, not that it patches without a reload.
            await expect
                .poll(
                    async () => {
                        await page.reload();
                        return merged.textContent();
                    },
                    { timeout: 30_000 },
                )
                .toBe('text-csszyx-next text-csszyx-live');
        });
    });
