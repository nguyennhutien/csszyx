import { base } from '../../tsdown.base.mjs';

export default {
    ...base,
    entry: {
        index: 'src/index.ts',
        config: 'src/config.ts',
        runtime: 'src/runtime.ts',
        compiler: 'src/compiler.ts',
    },
    format: ['esm', 'cjs'],
    platform: 'neutral',
    // react / react-dom MUST stay external: the declaration bundler would
    // otherwise walk the `import 'react'` augmentation in jsx.d.ts and inline
    // the whole `@types/react` tree.
    deps: { neverBundle: ['@csszyx/compiler', 'react', 'react-dom', 'solid-js'] },
    // tsc, not the Oxc generator `isolatedDeclarations` selects: Oxc widens
    // `export const DEFAULT_IMPORTED_STATIC_SZ = true` to `: boolean`.
    dts: { ...base.dts, generator: 'tsc' },
    // Hand-written type files, shipped as-is for the `./jsx*` subpaths.
    copy: ['src/jsx.d.ts', 'src/jsx-react.d.ts', 'src/jsx-solid.d.ts'],
};
