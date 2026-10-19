#!/usr/bin/env node
// Bundle the extension with esbuild.
// - vscode is external (provided by the host)
// - @csszyx/compiler is bundled inline (tree-shaken to only used exports)
// - Output is CommonJS (VS Code extension format)

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');
const COMPILER_SRC = path.resolve(import.meta.dirname, '../compiler/src') + path.sep;

/** @type {import('esbuild').BuildOptions} */
const options = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    // Tree-shake aggressively — only PROPERTY_MAP/transform/etc. survive
    treeShaking: true,
    minify: false,
    sourcemap: true,
    logLevel: 'info',
    // Resolve .js imports to .ts when the .ts file exists.
    // Required because @csszyx/compiler/browser is raw TypeScript and its internal
    // imports use .js extensions (e.g. `import ... from './color-validation.js'`).
    plugins: [{
        name: 'js-to-ts',
        setup(build) {
            build.onResolve({ filter: /\.js$/ }, args => {
                const tsPath = path.resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
                // A path a plugin resolves loses its package's `sideEffects`
                // flag; @csszyx/compiler declares `false`, which is what lets
                // an import from its index keep only the modules it uses.
                if (fs.existsSync(tsPath)) return { path: tsPath, sideEffects: !tsPath.startsWith(COMPILER_SRC) };
            });
        },
    }],
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('Watching for changes...');
} else {
    await esbuild.build(options);
}
