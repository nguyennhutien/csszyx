import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    // react / react-dom MUST be external — without this, unbuild's DTS
    // bundler walks the `import 'react'` augmentation in jsx.d.ts and
    // inlines the entire `@types/react` type tree (~16 700 lines).
    // When it flattens React's `PropTypes` namespace, the deprecated
    // `Validator<T> = undefined` declaration mangles to
    // `Validator<T> = undefined<T>` — invalid TypeScript — which crashes
    // every downstream consumer's tsc pass (Next.js playground, etc.).
    externals: ['@csszyx/compiler', 'react', 'react-dom', 'solid-js'],
    entries: ['./src/index', './src/config', './src/runtime', './src/compiler'],
    // node16: emit .d.mts + .d.cts only (no legacy .d.ts).
    declaration: 'node16',
    rollup: {
        emitCJS: true,
    },
    // jsx.d.ts / jsx-solid.d.ts are hand-written type files copied to dist
    // as-is by a hook.
    hooks: {
        async 'build:done'(ctx) {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            for (const file of ['jsx.d.ts', 'jsx-solid.d.ts']) {
                const src = path.resolve(ctx.options.rootDir, 'src', file);
                const dest = path.resolve(ctx.options.outDir, file);
                await fs.copyFile(src, dest);
            }
        },
    },
});
