/**
 * An adapter that cannot load fails the file that needed it, and the next file
 * of its framework tries again.
 *
 * The plugin keeps an adapter only once it has loaded, so a failed import is
 * not remembered as an answer: the bundler reports it on the file, and a build
 * whose install is repaired mid-session, a dev server, lowers the next file.
 * Its own file: vitest keeps a mocked module after one import of it succeeds,
 * so no other test may load the adapter first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { adapterTransformer, removeAdapterTestRoots } from './template-adapter-harness.js';

const broken = vi.hoisted(() => ({ vue: true }));

vi.mock('@csszyx/vue-adapter', async importOriginal => {
    if (broken.vue) throw new Error('the Vue adapter was loaded');
    return importOriginal();
});

afterEach(() => {
    removeAdapterTestRoots();
});

describe('a Vue adapter that cannot load', () => {
    it('fails the file, and loads for the next one', async () => {
        const transform = await adapterTransformer();
        await expect(
            transform('<template><div :sz="{ p: 4 }" /></template>', 'src/A.vue'),
        ).rejects.toThrow();
        broken.vue = false;
        const result = (await transform(
            '<template><div :sz="{ p: 4 }" /></template>',
            'src/B.vue',
        )) as { code: string };
        expect(result.code).toContain('p-4');
    });
});
