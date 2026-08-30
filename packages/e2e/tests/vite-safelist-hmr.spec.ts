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
 * reproducible bug, and why this spec reads the safelist before choosing its
 * padding: a value already in there would apply without a write, and the
 * branch under test would never run while the test passed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const fixturePath = fileURLToPath(
    new URL('../../../playground/vite-react/src/SafelistHmr.tsx', import.meta.url),
);
const safelistPath = fileURLToPath(
    new URL('../../../playground/vite-react/csszyx-classes.html', import.meta.url),
);

const BASELINE_LITERAL = "sz={{ pt: 7, bg: 'slate-100' }}";

/**
 * @param step - A padding step.
 * @returns Whether the safelist csszyx has written so far names `pt-<step>`.
 * A missing file is an empty safelist.
 */
async function safelistHolds(step: number): Promise<boolean> {
    const safelist = await readFile(safelistPath, 'utf8').catch(() => '');
    return safelist.split(/[\s"]+/).includes(`pt-${step}`);
}

/**
 * Spacing the running server has not emitted yet; `pt-7` is the baseline.
 *
 * The 40–79 range is clear of anything the playground uses, and a reused dev
 * server keeps every class it has seen, so the first step absent from its
 * safelist is the one that forces a write.
 *
 * @returns The padding step to edit in.
 */
async function unusedPadding(): Promise<number> {
    for (let step = 40; step < 80; step += 1) {
        if (!(await safelistHolds(step))) return step;
    }
    throw new Error('every step from pt-40 to pt-79 is in the safelist; restart the dev server');
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

            const padding = await unusedPadding();
            expect(await safelistHolds(padding), 'the class must be new to this server').toBe(
                false,
            );
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
            // The style can only have come from a safelist write; this is
            // the event the reload used to follow.
            expect(await safelistHolds(padding), 'csszyx must have written the safelist').toBe(
                true,
            );

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
