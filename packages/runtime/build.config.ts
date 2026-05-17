import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    // Two separate entries:
    //   index — main runtime, deps external (consumer's bundler resolves)
    //   lite  — slim runtime, @csszyx/compiler/color-var inlined so the
    //           lite bundle has zero runtime deps
    entries: [
        './src/index',
        {
            input: './src/lite',
            name: 'lite',
        },
    ],
    declaration: 'node16',
    rollup: {
        emitCJS: true,
        inlineDependencies: false,
    },
});
