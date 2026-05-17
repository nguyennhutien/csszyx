import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    // mkdist builder: per-file emission via tsc, no rollup-plugin-dts
    // bundling. Avoids the "vite types reference esbuild default"
    // failure that hits when rollup-plugin-dts walks the transitive
    // type chain through @csszyx/compiler.
    entries: [
        {
            builder: 'mkdist',
            input: './src',
            outDir: './dist',
            format: 'esm',
            declaration: true,
        },
        {
            builder: 'mkdist',
            input: './src',
            outDir: './dist',
            format: 'cjs',
            declaration: true,
        },
    ],
    // mkdist handles dts per-entry above; turn off the top-level
    // declaration flag so unbuild does not also schedule a rollup-dts
    // pass over the same source files.
    declaration: false,
    hooks: {
        async 'build:done'(ctx) {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const jsPath = path.resolve(ctx.options.outDir, 'index.js');
            const dtsPath = path.resolve(ctx.options.outDir, 'index.d.ts');

            await fs.copyFile(jsPath, path.resolve(ctx.options.outDir, 'index.cjs'));
            await fs.copyFile(dtsPath, path.resolve(ctx.options.outDir, 'index.d.mts'));
            await fs.copyFile(dtsPath, path.resolve(ctx.options.outDir, 'index.d.cts'));
        },
    },
});
