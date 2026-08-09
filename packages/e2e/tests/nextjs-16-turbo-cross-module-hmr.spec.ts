import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

/**
 * A style module edited during a live Turbopack dev session.
 *
 * Every link of this chain is unit-tested on its own, and none of those tests
 * can show the chain holding together:
 *
 *   1. Turbopack re-runs the loader on the IMPORTER, because the loader
 *      declared the provider through `addDependency`.
 *   2. The loader recompiles against the provider's new value.
 *   3. Its safelist shard is rewritten — same source path, different classes.
 *   4. `csszyx next watch` materializes the shards into the `@source` file.
 *   5. Tailwind regenerates CSS and the browser receives the new rule.
 *
 * The importing page is never touched. That is the whole point: `page.tsx` is
 * byte-identical before and after, so nothing here can be explained by the
 * ordinary source-edit HMR path that the sibling spec covers.
 */
const providerPath = fileURLToPath(
    new URL('../../../playground/nextjs-16/app/turbo-csszyx/styles.ts', import.meta.url),
);
const importerPath = fileURLToPath(
    new URL('../../../playground/nextjs-16/app/turbo-csszyx/page.tsx', import.meta.url),
);

const safelistPath = fileURLToPath(
    new URL('../../../playground/nextjs-16/.csszyx/next-loader-classes.html', import.meta.url),
);

const BASELINE_LITERAL = 'p: 7';
const MUTATED_LITERAL = 'p: 9';
const MUTATED_CLASS = 'p-9';

test.describe
    .serial('Next.js 16 Turbopack cross-module HMR', () => {
        let originalProvider = '';

        test.beforeAll(async () => {
            originalProvider = await readFile(providerPath, 'utf8');
            if (!originalProvider.includes(BASELINE_LITERAL)) {
                throw new Error(
                    `Cross-module baseline literal not found in ${providerPath}. ` +
                        'The provider value is part of the integration contract.',
                );
            }
        });

        test.beforeEach(async () => {
            await writeFile(providerPath, originalProvider);
        });

        test.afterAll(async () => {
            await writeFile(providerPath, originalProvider);
        });

        test('editing the provider restyles its importer without touching it', async ({ page }) => {
            const importerBefore = await readFile(importerPath, 'utf8');

            // The mutated class must not already be safelisted, or the final
            // assertion would hold whether or not the edit reached anything.
            // Reading rather than resetting the file on purpose: two other
            // specs share this dev server, and rewriting their `@source` under
            // them would trade one vacuous pass for a flaky neighbour.
            expect(
                await readFile(safelistPath, 'utf8'),
                `${MUTATED_CLASS} is already safelisted — a leftover from an interrupted run would make this test pass without proving anything`,
            ).not.toContain(MUTATED_CLASS);

            await page.goto('/turbo-csszyx');

            const target = page.getByTestId('next16-csszyx-cross-module');
            await expect(target).toBeVisible();

            // The baseline has to come from a real rule, not from the class
            // merely being applied: a runtime fallback would also put `p-7` on
            // the element while no stylesheet defined it.
            await expect
                .poll(
                    async () => target.evaluate(element => getComputedStyle(element).paddingTop),
                    { timeout: 30_000 },
                )
                .toBe('28px');

            const mutated = originalProvider.replace(BASELINE_LITERAL, MUTATED_LITERAL);
            if (mutated === originalProvider) {
                throw new Error('Provider mutation produced no change — baseline literal moved?');
            }
            const startedAt = Date.now();
            await writeFile(providerPath, mutated);

            await expect
                .poll(
                    async () => target.evaluate(element => getComputedStyle(element).paddingTop),
                    { timeout: 30_000 },
                )
                .toBe('36px');
            const elapsedMs = Date.now() - startedAt;

            // The claim this spec exists to make: the importer never changed.
            // Without it, a reader cannot tell this from ordinary source HMR.
            expect(
                await readFile(importerPath, 'utf8'),
                'the importing module must be untouched — its restyling came entirely from the provider',
            ).toBe(importerBefore);

            console.log(`[csszyx-xmod] provider edit 28px -> 36px took ${elapsedMs} ms`);
        });
    });
