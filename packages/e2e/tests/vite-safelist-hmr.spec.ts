/**
 * A brand-new utility class must hot-update, not reload the page.
 *
 * Field report (csszyx 0.14.1): the first time an `sz` edit produced a class
 * the app had never used, csszyx wrote the generated safelist and Vite
 * full-reloaded — because the safelist is named `.html`, and Vite reloads for
 * any changed `.html` that matched no module. Developers lost filters, scroll
 * position, open dialogs and in-flight form input on a spacing tweak, while
 * the stylesheet had already been hot-updated correctly in the same tick.
 *
 * The second identical edit was clean, because the class set only grows once
 * per server lifetime. That is why it read as "HMR is flaky" rather than as a
 * reproducible bug, and why this spec picks a padding value at random: a
 * fixed one would be in the safelist after the first run and the test would
 * pass without exercising anything.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const fixturePath = fileURLToPath(
    new URL('../../../playground/vite-react/src/SafelistHmr.tsx', import.meta.url),
);

const BASELINE_LITERAL = "sz={{ pt: 7, bg: 'slate-100' }}";

/**
 * Spacing Tailwind will not already have emitted; `pt-7` is the baseline.
 *
 * @returns A padding step in the 40–79 range, well clear of anything the
 * playground uses, so the class is new to the safelist on every run.
 */
function unusedPadding(): number {
    return 40 + Math.floor(Math.random() * 40);
}

test.describe
    .serial('Vite safelist HMR', () => {
        let originalSource = '';

        test.beforeAll(async () => {
            originalSource = await readFile(fixturePath, 'utf8');
            if (!originalSource.includes(BASELINE_LITERAL)) {
                throw new Error(
                    `Baseline literal not found in ${fixturePath}. It is part of the ` +
                        'integration contract; do not reflow it.',
                );
            }
        });

        test.afterAll(async () => {
            await writeFile(fixturePath, originalSource);
        });

        test('a class the safelist has never held applies without a page reload', async ({
            page,
        }) => {
            let loadCount = 0;
            page.on('load', () => {
                loadCount += 1;
            });

            await page.goto('/?page=safelist-hmr');
            const target = page.getByTestId('safelist-hmr-target');
            await expect(target).toBeVisible();
            await expect
                .poll(async () => target.evaluate(node => getComputedStyle(node).paddingTop))
                .toBe('28px');

            const loadsBeforeEdit = loadCount;
            await page.evaluate(() => {
                (
                    window as unknown as { __csszyxSafelistSentinel?: string }
                ).__csszyxSafelistSentinel = 'baseline';
            });

            const padding = unusedPadding();
            await writeFile(
                fixturePath,
                originalSource.replace(
                    BASELINE_LITERAL,
                    `sz={{ pt: ${padding}, bg: 'slate-100' }}`,
                ),
            );

            // The rule only exists once csszyx has written the safelist and
            // Tailwind has regenerated, so this poll is the real subject.
            await expect
                .poll(async () => target.evaluate(node => getComputedStyle(node).paddingTop), {
                    timeout: 30_000,
                })
                .toBe(`${padding * 4}px`);

            const sentinel = await page.evaluate(
                () =>
                    (window as unknown as { __csszyxSafelistSentinel?: string })
                        .__csszyxSafelistSentinel,
            );
            expect(
                sentinel,
                'window sentinel must survive the safelist write — a full reload wipes it',
            ).toBe('baseline');
            expect(loadCount, 'the safelist write must not navigate the page').toBe(
                loadsBeforeEdit,
            );
        });
    });
