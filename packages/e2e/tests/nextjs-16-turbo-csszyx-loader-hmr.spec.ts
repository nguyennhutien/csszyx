import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const routePath = fileURLToPath(
    new URL('../../../playground/nextjs-16/app/turbo-csszyx/page.tsx', import.meta.url),
);

const BASELINE_LITERAL =
    "sz={{ p: 4, bg: 'sky-500', color: 'white', rounded: 'md', weight: 'semibold' }}";
const MUTATED_LITERAL =
    "sz={{ p: 8, bg: 'sky-500', color: 'white', rounded: 'md', weight: 'semibold' }}";

async function readSource(): Promise<string> {
    return readFile(routePath, 'utf8');
}

async function writeSource(content: string): Promise<void> {
    await writeFile(routePath, content);
}

test.describe
    .serial('Next.js 16 Turbopack csszyx loader HMR', () => {
        let originalSource = '';

        test.beforeAll(async () => {
            originalSource = await readSource();
            if (!originalSource.includes(BASELINE_LITERAL)) {
                throw new Error(
                    `HMR baseline literal not found in ${routePath}. ` +
                        'The sentinel line is part of the integration contract; do not reflow it.',
                );
            }
        });

        test.beforeEach(async () => {
            await writeSource(originalSource);
        });

        test.afterAll(async () => {
            await writeSource(originalSource);
        });

        test('source edit re-applies sz transform via loader without a full page reload', async ({
            page,
        }) => {
            let loadCount = 0;
            page.on('load', () => {
                loadCount += 1;
            });

            await page.goto('/turbo-csszyx');

            const target = page.getByTestId('next16-csszyx-hmr-target');
            await expect(target).toBeVisible();

            await expect
                .poll(
                    async () => target.evaluate(element => getComputedStyle(element).paddingTop),
                    { timeout: 30_000 },
                )
                .toBe('16px');

            const loadsBeforeEdit = loadCount;
            await page.evaluate(() => {
                (window as unknown as { __csszyxHmrSentinel?: string }).__csszyxHmrSentinel =
                    'baseline';
            });

            const mutated = originalSource.replace(BASELINE_LITERAL, MUTATED_LITERAL);
            if (mutated === originalSource) {
                throw new Error('Source mutation produced no change — baseline literal moved?');
            }
            const startedAt = Date.now();
            await writeSource(mutated);

            await expect
                .poll(
                    async () => target.evaluate(element => getComputedStyle(element).paddingTop),
                    { timeout: 20_000 },
                )
                .toBe('32px');
            const elapsedMs = Date.now() - startedAt;

            const sentinel = await page.evaluate(
                () => (window as unknown as { __csszyxHmrSentinel?: string }).__csszyxHmrSentinel,
            );
            expect(
                sentinel,
                'window sentinel must survive HMR — a full reload would have wiped it',
            ).toBe('baseline');
            expect(
                loadCount,
                'page.on(load) must not fire between edit and computed-style assertion',
            ).toBe(loadsBeforeEdit);

            // Diagnostic — not asserted as a hard bar, but logged so the risk review
            // captures real numbers when the spec runs.

            console.log(`[csszyx-hmr] padding 16px -> 32px took ${elapsedMs} ms`);
        });
    });
