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
    externals: ['@csszyx/compiler', 'react', 'react-dom'],
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
