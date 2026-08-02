import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    entries: [
        './src/index',
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
                define: { 'process.env.NODE_ENV': '"production"' },
            });

            // Prepend the JSX type reference to dist/index.d.mts so
            // consumers picking up types via the umbrella package see
            // the JSX intrinsic element declarations.
            const dtsPath = path.resolve(ctx.options.outDir, 'index.d.mts');
            try {
                const existing = await fs.readFile(dtsPath, 'utf-8');
                const reference = '/// <reference types="@csszyx/types/jsx" />\n';
                if (!existing.startsWith(reference)) {
                    await fs.writeFile(dtsPath, reference + existing);
                }
            } catch {
                // index.d.mts may not exist if declarations are off.
            }
        },
    },
});
