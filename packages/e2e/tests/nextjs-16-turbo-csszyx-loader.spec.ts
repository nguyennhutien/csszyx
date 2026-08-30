import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const loaderSafelistPath = fileURLToPath(
    new URL('../../../playground/nextjs-16/.csszyx/next-loader-classes.txt', import.meta.url),
);
const placeholderSource = '# Next 16 csszyx Turbopack loader safelist placeholder.\n';

test.describe('Next.js 16 Turbopack csszyx Loader', () => {
    test.beforeAll(async () => {
        await mkdir(dirname(loaderSafelistPath), { recursive: true });
        await writeFile(loaderSafelistPath, placeholderSource);
    });

    // No afterAll counterpart on purpose. Emptying the file is what this spec
    // needs BEFORE it runs — proof that the build filled it — but it restores
    // nothing afterwards: the file is generated state shared with every other
    // spec on this dev server, and only a shard change rebuilds it. Leaving it
    // emptied hands the next spec a project whose classes have no CSS, which is
    // both a false failure and, because Tailwind re-reads `@source` on each
    // rewrite, a way to make its regeneration miss the change that matters.

    test('transforms sz and materializes Tailwind classes through @source', async ({ page }) => {
        await page.goto('/turbo-csszyx');

        const target = page.getByTestId('next16-csszyx-loader-target');
        await expect(target).toBeVisible();
        await expect(target).toContainText('csszyx Turbopack loader transformed');

        await expect
            .poll(async () =>
                target.evaluate(element => {
                    const computed = getComputedStyle(element);
                    return (
                        computed.paddingTop === '40px' &&
                        computed.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                        computed.backgroundColor !== 'transparent' &&
                        computed.color === 'rgb(255, 255, 255)' &&
                        computed.borderTopLeftRadius === '8px' &&
                        computed.fontWeight === '600'
                    );
                }),
            )
            .toBe(true);
    });

    test('compiles a style object imported through the tsconfig alias', async ({ page }) => {
        // This lane has no whole-project prescan: the loader is handed one file
        // and reads the provider from disk itself, then declares it so an edit
        // to the style module invalidates its importers. A real Turbopack build
        // is where that arrangement exists as itself.
        await page.goto('/turbo-csszyx');

        const target = page.getByTestId('next16-csszyx-cross-module');
        await expect(target).toBeVisible();

        // The class ships either way — the runtime fallback applies it too.
        // Only a build that compiled the attribute puts the class where the
        // prebuild could safelist it, so the rule is what tells them apart.
        await expect
            .poll(async () =>
                target.evaluate(element => {
                    const computed = getComputedStyle(element);
                    return computed.paddingTop === '28px' && computed.letterSpacing !== 'normal';
                }),
            )
            .toBe(true);
    });
});
