/**
 * A Vue or Svelte template under a Tailwind prefix gets the prefixed class,
 * the same class a JSX `sz` gets in the same project. Without the prefix the
 * class is one Tailwind never serves, and the element is unstyled with a
 * green build.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(removeTailwindProjects);

describe('a template under a Tailwind prefix', () => {
    it.each([
        ['a Vue SFC', 'src/Comp.vue', '<template><div sz="{ p: 4 }"></div></template>'],
        ['a Svelte component', 'src/Comp.svelte', '<div sz={{ p: 4 }}></div>'],
    ])(
        'writes the prefixed class in %s',
        async (_name, file, source) => {
            const root = tailwindProject('csszyx-template-prefix-', {
                'src/styles.css': '@import "tailwindcss" prefix(tw);\n',
                [file]: source,
            });
            const plugins = vitePlugin({ production: { mangle: false } }) as unknown as Record<
                string,
                unknown
            >[];
            const call = callHooks(plugins);

            await call('configResolved', { root, command: 'build' });
            const result = (await call('transform', source, join(root, file))) as { code: string };

            expect(result.code).toContain('class="tw:p-4"');
        },
        60_000,
    );
});
