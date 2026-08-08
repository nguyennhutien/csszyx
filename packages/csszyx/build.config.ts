import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    entries: [
        './src/index',
        './src/index.browser',
        './src/lite',
        './src/vite',
        './src/webpack',
        './src/dynamic',
        './src/dynamic-react',
        './src/core',
        './src/lowering',
    ],
    declaration: 'node16',
    rollup: {
        emitCJS: false,
    },
    hooks: {
        async 'build:done'(ctx) {
            // Build the browser IIFE bundle and stamp the JSX type
            // reference into the umbrella .d.ts. tsup did this inline;
            // unbuild gives us a hook to do the same after rollup writes
            // its outputs.
            const { build } = await import('esbuild');
            const fs = await import('node:fs/promises');
            const path = await import('node:path');

            // IIFE bundle for the CDN/<script> use case.
            await build({
                entryPoints: [path.resolve(ctx.options.rootDir, 'src/browser.ts')],
                outfile: path.resolve(ctx.options.outDir, 'browser.iife.js'),
                bundle: true,
                minify: true,
                platform: 'browser',
                format: 'iife',
                define: {
                    'process.env.NODE_ENV': '"production"',
                    // A page loading this over a CDN has no `process`, so any
                    // surviving read is a ReferenceError waiting for whoever
                    // makes that path reachable. The hint it guards tells you to
                    // run the project scanner, which a script-tag page has no
                    // project for — so the honest substitution is "silenced".
                    'process.env.CSSZYX_NO_PROJECT_SCAN_HINT': '"1"',
                },
            });

            // Prepend the JSX type reference to the umbrella .d.mts files so
            // consumers picking up types via the umbrella package see the JSX
            // intrinsic element declarations. Both entries need it: a consumer
            // resolving under the `browser` condition gets the browser
            // declarations and would otherwise lose the `sz` prop.
            const reference = '/// <reference types="@csszyx/types/jsx" />\n';
            for (const name of ['index.d.mts', 'index.browser.d.mts']) {
                const dtsPath = path.resolve(ctx.options.outDir, name);
                try {
                    const existing = await fs.readFile(dtsPath, 'utf-8');
                    if (!existing.startsWith(reference)) {
                        await fs.writeFile(dtsPath, reference + existing);
                    }
                } catch {
                    // The .d.mts files may not exist if declarations are off.
                }
            }
        },
    },
});
