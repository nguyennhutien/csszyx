/**
 * A build loads only the adapter of the frameworks it has files of.
 *
 * Each adapter here fails to load, so a build that reached one it had no file
 * for would fail: lowering React, Vue or Svelte alone must not touch the other
 * frameworks' adapters. The real adapter is restored for the framework a test
 * lowers. vitest keeps a mocked module once one import of it has succeeded,
 * so every test here that expects the broken import runs before the first
 * that restores it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    removeAdapterTestRoots,
    adapterTransformer as transformer,
} from './template-adapter-harness.js';

const broken = vi.hoisted(() => ({ vue: true, svelte: true }));

vi.mock('@csszyx/vue-adapter', async importOriginal => {
    if (broken.vue) throw new Error('the Vue adapter was loaded');
    return importOriginal();
});
vi.mock('@csszyx/svelte-adapter', async importOriginal => {
    if (broken.svelte) throw new Error('the Svelte adapter was loaded');
    return importOriginal();
});

afterEach(() => {
    removeAdapterTestRoots();
    vi.resetModules();
    broken.vue = true;
    broken.svelte = true;
});

describe('a framework file', () => {
    it('loads no adapter when it holds no sz', async () => {
        const transform = await transformer();
        const result = await transform('<template><div class="p-4" /></template>', 'src/A.vue');
        expect((result as { code: string } | null)?.code ?? '').not.toContain(':sz');
    });
});

describe('a build of one framework', () => {
    it('lowers React with neither adapter', async () => {
        const transform = await transformer();
        const result = (await transform(
            'export const A = () => <div sz={{ p: 4 }} />;',
            'src/A.tsx',
        )) as {
            code: string;
        };
        expect(result.code).toContain('p-4');
    });

    it('lowers Vue with the Vue adapter alone', async () => {
        broken.vue = false;
        const transform = await transformer();
        const result = (await transform(
            '<template><div :sz="{ p: 4 }" /></template>',
            'src/A.vue',
        )) as {
            code: string;
        };
        expect(result.code).toContain('p-4');
    });

    it('lowers Svelte with the Svelte adapter alone', async () => {
        broken.svelte = false;
        const transform = await transformer();
        const result = (await transform('<div sz={{ p: 4 }}></div>', 'src/A.svelte')) as {
            code: string;
        };
        expect(result.code).toContain('p-4');
    });
});
