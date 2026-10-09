import { base, defineBuild } from '../../tsdown.base.mjs';

export default defineBuild({
    ...base,
    // One module out per source module, as unbuild's mkdist builder did;
    // @csszyx/compiler stays an import, never inlined.
    entry: { index: 'src/index.ts' },
    unbundle: true,
    // `vite` is imported for its `Plugin` type only and is not a dependency;
    // left to the default, the declaration bundler walks vite's types into
    // postcss's CommonJS ones and fails.
    deps: { neverBundle: ['vite'] },
    format: ['esm', 'cjs'],
    platform: 'neutral',
    // Named CJS exports plus `exports.default`, matching `index.d.cts`. mkdist
    // ended its CJS file with `module.exports = <default>`, which dropped every
    // named export from `require()` (unplugin's CJS lane calls `.preprocess`).
    outputOptions: { ...base.outputOptions, exports: 'named' },
});
