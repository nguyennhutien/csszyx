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
 * Every claim below is anchored to an edit this test makes, never to the state
 * it found. The `@source` file is shared with sibling specs on the same dev
 * server and one of them resets it when it finishes, which is legitimate — but
 * it cannot be undone by rewriting a file with the same contents. An unchanged
 * source yields an identical shard, the loader correctly declines to rewrite
 * it, the watcher gets no event, and the reset `@source` file stays reset. So
 * a baseline read from ambient state describes whichever sibling ran last, not
 * this feature.
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
            // Reading rather than resetting the file on purpose: siblings share
            // this dev server, and rewriting their `@source` under them would
            // trade one vacuous pass for a flaky neighbour.
            expect(
                await readFile(safelistPath, 'utf8'),
                `${MUTATED_CLASS} is already safelisted — a leftover from an interrupted run would make this test pass without proving anything`,
            ).not.toContain(MUTATED_CLASS);

            await page.goto('/turbo-csszyx');

            const target = page.getByTestId('next16-csszyx-cross-module');
            await expect(target).toBeVisible();

            const paddingOf = async (): Promise<string> =>
                target.evaluate(element => getComputedStyle(element).paddingTop);

            // The second half of the anti-vacuity guard, and the reason it is
            // written as a NEGATIVE: whether the element starts at its declared
            // padding or at nothing depends on what the last sibling left in the
            // shared `@source` file. What must be true either way is that it is
            // not already showing the value the edit is supposed to produce.
            expect(
                await paddingOf(),
                'the element already has the padding this test is about to produce, so reaching it would prove nothing',
            ).not.toBe(MUTATED_PADDING);

            const mutated = originalProvider.replace(BASELINE_LITERAL, MUTATED_LITERAL);
            if (mutated === originalProvider) {
                throw new Error('Provider mutation produced no change — baseline literal moved?');
            }
            const startedAt = Date.now();
            await writeFile(providerPath, mutated);

            // Reaching this value proves the whole chain at once: the class was
            // recompiled from the provider's new value, it reached the safelist,
            // and Tailwind generated a real rule for it. A runtime fallback
            // would put the class on the element with no rule behind it, which
            // computes to `0px` rather than to this.
            await expect.poll(paddingOf, { timeout: 30_000 }).toBe(MUTATED_PADDING);
            const elapsedMs = Date.now() - startedAt;

            // The claim this spec exists to make: the importer never changed.
            // Without it, a reader cannot tell this from ordinary source HMR.
            expect(
                await readFile(importerPath, 'utf8'),
                'the importing module must be untouched — its restyling came entirely from the provider',
            ).toBe(importerBefore);

            console.log(`[csszyx-xmod] provider edit -> ${MUTATED_PADDING} took ${elapsedMs} ms`);
        });
    });
