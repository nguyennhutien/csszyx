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
 *
 * This runs on a dev server of its own, over a route with its own safelist and
 * its own Tailwind entry. It used to share the playground's main Turbopack
 * server, and every part of the chain csszyx owns was correct there — measured,
 * the shard and the safelist gained the new class in about a tenth of a second.
 * What could not keep up was link 5, because sibling specs rewrite the shared
 * entry's `@source` files while the suite runs. Isolating the route removes
 * that interference rather than waiting it out, so a failure here means the
 * chain is actually broken.
 */
const providerPath = fileURLToPath(
    new URL('../../../playground/nextjs-16/app/turbo-xmod/styles.ts', import.meta.url),
);
const importerPath = fileURLToPath(
    new URL('../../../playground/nextjs-16/app/turbo-xmod/page.tsx', import.meta.url),
);
const safelistPath = fileURLToPath(
    new URL('../../../playground/nextjs-16/.csszyx/xmod/classes.html', import.meta.url),
);

const BASELINE_LITERAL = 'p: 7';
const BASELINE_PADDING = '28px';
const MUTATED_LITERAL = 'p: 9';
const MUTATED_CLASS = 'p-9';
const MUTATED_PADDING = '36px';

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
            expect(
                await readFile(safelistPath, 'utf8'),
                `${MUTATED_CLASS} is already safelisted — a leftover from an interrupted run would make this test pass without proving anything`,
            ).not.toContain(MUTATED_CLASS);

            await page.goto('/turbo-xmod');

            const target = page.getByTestId('xmod-card');
            await expect(target).toBeVisible();

            const paddingOf = async (): Promise<string> =>
                target.evaluate(element => getComputedStyle(element).paddingTop);

            // The baseline has to come from a real rule, not from the class
            // merely being applied: a runtime fallback would put `p-7` on the
            // element with no stylesheet defining it, which computes to `0px`.
            // On a server nothing else disturbs, this states a fact about the
            // feature rather than about whichever spec ran last.
            await expect.poll(paddingOf, { timeout: 30_000 }).toBe(BASELINE_PADDING);

            const mutated = originalProvider.replace(BASELINE_LITERAL, MUTATED_LITERAL);
            if (mutated === originalProvider) {
                throw new Error('Provider mutation produced no change — baseline literal moved?');
            }
            const startedAt = Date.now();
            await writeFile(providerPath, mutated);

            await expect.poll(paddingOf, { timeout: 30_000 }).toBe(MUTATED_PADDING);
            const elapsedMs = Date.now() - startedAt;

            // The claim this spec exists to make: the importer never changed.
            // Without it, a reader cannot tell this from ordinary source HMR.
            expect(
                await readFile(importerPath, 'utf8'),
                'the importing module must be untouched — its restyling came entirely from the provider',
            ).toBe(importerBefore);

            console.log(
                `[csszyx-xmod] provider edit ${BASELINE_PADDING} -> ${MUTATED_PADDING} took ${elapsedMs} ms`,
            );
        });
    });
