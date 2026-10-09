import { base, defineBuild } from '../../tsdown.base.mjs';

export default defineBuild({
    ...base,
    entry: {
        // Main runtime; dependencies stay external (the consumer's bundler
        // resolves @csszyx/compiler and @csszyx/core).
        index: 'src/index.ts',
        // Slim runtime.
        lite: 'src/lite.ts',
        // Slot-based string helpers; the bundler plugin points injected and
        // rewritten imports here so object-free files skip the compiler.
        core: 'src/core.ts',
        // The group-merge family; separate from core so an szr-only bundle
        // never carries the box-role tables.
        merge: 'src/merge.ts',
        // The className half of the class toolkit, without the sz adapters. A
        // project that only writes Tailwind strings should not have to resolve
        // the compiler's key vocabulary to ask what a class is.
        split: 'src/split.ts',
        // Side-effecting registration entry (`import '@csszyx/runtime/lowering'`).
        // Own entry on purpose: inlining its top-level call into the barrel
        // would defeat tree shaking. `sideEffects` in package.json names it.
        lowering: 'src/lowering-register.ts',
    },
    format: ['esm', 'cjs'],
    platform: 'neutral',
});
