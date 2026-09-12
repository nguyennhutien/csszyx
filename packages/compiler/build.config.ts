import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    entries: [
        './src/index',
        './src/bool-class',
        './src/color-var',
        './src/spacing-var',
        // Browser-pure transform (no Babel deps). Tree-shakes cleanly
        // for browser bundles via @csszyx/dynamic + @csszyx/runtime.
        './src/transform-core',
        // The depth limit, its error and the key guard on their own. The
        // runtime's `core` and `merge` entries need these and nothing else;
        // importing them through `transform-core` pulled in its shared chunk,
        // whose property tables are built by module-level calls a bundler
        // cannot prove pure and so ship whether or not anything reads them.
        './src/sz-limits',
        './src/migrate-rust',
    ],
    declaration: 'node16',
    rollup: {
        emitCJS: true,
    },
});
