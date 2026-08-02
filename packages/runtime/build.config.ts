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
        // core — slot-based string helpers; the bundler plugin points injected
        // and rewritten imports here so object-free files skip the compiler.
        {
            input: './src/core',
            name: 'core',
        },
        // merge — the group-merge family; separate from core so an szr-only
        // bundle never carries the box-role tables.
        {
            input: './src/merge',
            name: 'merge',
        },
        // lowering — side-effecting registration entry (`import
        // '@csszyx/runtime/lowering'`). Own entry on purpose: inlining its
        // top-level call into the barrel would defeat tree shaking.
        {
            input: './src/lowering-register',
            name: 'lowering',
        },
    ],
    declaration: 'node16',
    rollup: {
        emitCJS: true,
        inlineDependencies: false,
    },
});
