import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { base, defineBuild } from '../../tsdown.base.mjs';

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
            const { cwd, outDir } = ctx.options;

            // IIFE bundles for the CDN/<script> use case, still built by
            // esbuild: they are minified whole, so the comment handling that
            // moved the library entries to Rolldown does not apply, and the
            // production artifact stays byte-identical to the one users
            // already load. Two of them, as React ships two: the production
            // one prints each diagnostic as its code, its args and its page,
            // and `browser.dev.iife.js` prints the sentence, with the
            // development warnings the production one folds out, for a page
            // under development, which has no build log to read them in.
            const { build } = await import('esbuild');
            for (const [file, mode] of [
                ['browser.iife.js', 'production'],
                ['browser.dev.iife.js', 'development'],
            ]) {
                await build({
                    entryPoints: [resolve(cwd, 'src/browser.ts')],
                    outfile: resolve(outDir, file),
                    bundle: true,
                    minify: true,
                    platform: 'browser',
                    format: 'iife',
                    define: {
                        'process.env.NODE_ENV': JSON.stringify(mode),
                        // A page loading this over a CDN has no `process`, so
                        // any surviving read is a ReferenceError waiting for
                        // whoever makes that path reachable. The hint it guards
                        // tells you to run the project scanner, which a
                        // script-tag page has no project for — so the honest
                        // substitution is "silenced".
                        'process.env.CSSZYX_NO_PROJECT_SCAN_HINT': '"1"',
                        // A script-tag page cannot set an environment variable,
                        // so the switch that mutes sz warnings is never on here.
                        'process.env.CSSZYX_QUIET_SZ_WARNINGS': 'undefined',
                    },
                });
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
