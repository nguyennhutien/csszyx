import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    externals: ['@csszyx/compiler'],
    entries: ['./src/index', './src/config', './src/runtime', './src/compiler'],
    // node16: emit .d.mts + .d.cts only (no legacy .d.ts).
    declaration: 'node16',
    rollup: {
        emitCJS: true,
    },
    // jsx.d.ts is a hand-written type file copied to dist as-is by a hook.
    hooks: {
        async 'build:done'(ctx) {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const src = path.resolve(ctx.options.rootDir, 'src/jsx.d.ts');
            const dest = path.resolve(ctx.options.outDir, 'jsx.d.ts');
            await fs.copyFile(src, dest);
        },
    },
});
