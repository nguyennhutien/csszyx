import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const sourcePath = fileURLToPath(
    new URL('../../../playground/nextjs-16/.csszyx/csszyx-classes.txt', import.meta.url),
);
const placeholderSource = '# Tailwind @source target used by the Next 16 Turbopack source probe.\n';

test.describe('Next.js 16 Turbopack Tailwind @source Probe', () => {
    test.beforeAll(async () => {
        await writeFile(sourcePath, placeholderSource);
    });

    test.afterAll(async () => {
        await writeFile(sourcePath, placeholderSource);
    });

    test('regenerates Tailwind utilities from @source without restarting Turbopack', async ({
        page,
    }) => {
        await page.goto('/tailwind-source');

        const target = page.getByTestId('next16-source-target');
        await expect(target).toBeVisible();

        const before = await target.evaluate(element => {
            const computed = getComputedStyle(element);
            return {
                paddingTop: computed.paddingTop,
                backgroundColor: computed.backgroundColor,
            };
        });

        expect(before.paddingTop).toBe('16px');
        expect(before.backgroundColor).toBe('rgba(0, 0, 0, 0)');

        await writeFile(
            sourcePath,
            ['# updated by nextjs-16-tailwind-source.spec', 'p-8', 'bg-red-500', ''].join('\n'),
        );

        await expect
            .poll(async () =>
                target.evaluate(element => {
                    element.classList.add('p-8', 'bg-red-500');
                    const computed = getComputedStyle(element);
                    return (
                        computed.paddingTop === '32px' &&
                        computed.backgroundColor !== 'rgba(0, 0, 0, 0)'
                    );
                }),
            )
            .toBe(true);
    });
});
