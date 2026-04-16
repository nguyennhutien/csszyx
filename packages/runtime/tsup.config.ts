import { defineConfig } from 'tsup';

export default defineConfig([
    // Main bundle — all deps are external (runtime imports stay as imports).
    {
        entry: { index: 'src/index.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        clean: true,
    },
    // Lite bundle — @csszyx/compiler/color-var is inlined so dist/lite.js has
    // zero runtime deps. Tree-shaking ensures only __szColorVar is pulled in.
    {
        entry: { lite: 'src/lite.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        noExternal: [/@csszyx\/compiler/],
        treeshake: true,
    },
]);
