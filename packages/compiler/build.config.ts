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
    ],
    declaration: 'node16',
    rollup: {
        emitCJS: true,
    },
});
