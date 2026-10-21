import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { base, defineBuild } from '../../tsdown.base.mjs';
import { CDN_BUNDLES, cdnBuildOptions } from './cdn-build.mjs';

const JSX_REFERENCE = '/// <reference types="@csszyx/types/jsx" />\n';

export default defineBuild({
    ...base,
    entry: {
        index: 'src/index.ts',
        'index.browser': 'src/index.browser.ts',
        lite: 'src/lite.ts',
        vite: 'src/vite.ts',
        webpack: 'src/webpack.ts',
        dynamic: 'src/dynamic.ts',
        'dynamic-react': 'src/dynamic-react.ts',
        core: 'src/core.ts',
        lowering: 'src/lowering.ts',
    },
    format: ['esm'],
    platform: 'neutral',
    hooks: {
        async 'build:done'(ctx) {
            const { outDir } = ctx.options;

            // The CDN bundles, built from the compiler's `dist` (see
            // `cdn-build.mjs`, which the size gate reads them back with).
            const { build } = await import('esbuild');
            for (const { file, mode } of CDN_BUNDLES) {
                await build({ ...cdnBuildOptions(mode), outfile: resolve(outDir, file) });
            }

            // The declaration bundler drops the triple-slash reference in
            // src/index.ts, so stamp it back. Both entries need it: a consumer
            // resolving under the `browser` condition gets the browser
            // declarations and would otherwise lose the `sz` prop.
            await Promise.all(
                ['index.d.mts', 'index.browser.d.mts'].map(async name => {
                    const path = resolve(outDir, name);
                    const existing = await readFile(path, 'utf-8');
                    if (!existing.startsWith(JSX_REFERENCE)) {
                        await writeFile(path, JSX_REFERENCE + existing);
                    }
                }),
            );
        },
    },
});
