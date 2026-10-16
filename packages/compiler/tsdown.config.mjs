import { base, defineBuild } from '../../tsdown.base.mjs';

export default defineBuild({
    ...base,
    entry: {
        index: 'src/index.ts',
        'bool-class': 'src/bool-class.ts',
        'color-var': 'src/color-var.ts',
        'spacing-var': 'src/spacing-var.ts',
        // Browser-pure transform (no oxc-parser or native deps): what @csszyx/dynamic and
        // @csszyx/runtime pull into an app bundle.
        'transform-core': 'src/transform-core.ts',
        // The depth limit, its error and the key guard on their own, so the
        // runtime's `core` and `merge` entries do not pull the property tables.
        'sz-limits': 'src/sz-limits.ts',
        // The stand-alone keyword families and their pure settlement, for the
        // runtime's `szv` merge, without the transform's property tables.
        'keyword-families': 'src/keyword-families.ts',
        'migrate-rust': 'src/migrate-rust.ts',
        // What the adapters, the CLI and the build plugin share; not a stable API.
        internal: 'src/internal.ts',
    },
    format: ['esm', 'cjs'],
    platform: 'neutral',
    // `csstype` is a dependency, imported by the declarations: inlined, it was
    // most of 1.9 MB of `.d.ts`, which a React or Vue app with TypeScript
    // already installs once for `@types/react` or `@vue/runtime-dom`.
    deps: { neverBundle: ['csstype'] },
});
