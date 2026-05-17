/**
 * csszyx - Universal CSS-in-JS for Tailwind CSS with WASM core.
 *
 * This is the main entry point that provides a unified API for:
 * - Core Rust WASM (encoding, mangling, checksum)
 * - Runtime helpers (_sz, _szIf, lite bundle)
 * - Compiler logic (transform, manifest, recovery)
 * - Unplugin (Vite, Webpack, Rollup, esbuild)
 * - TypeScript types
 */

// === Compiler ===
export {
    type SzObject,
    serializeManifest,
    transform,
    transformSourceCode,
    validateSzRecover,
} from '@csszyx/compiler';
// === Core WASM ===
export {
    compute_mangle_checksum,
    encode,
    transform_sz,
    verify_mangle_checksum,
} from '@csszyx/core';
// === Runtime Helpers ===
// === Variant Authoring ===
// === Hydration & SSR ===
export {
    _sz,
    _sz2,
    _sz3,
    _szIf,
    _szMerge,
    _szSwitch,
    abortHydration,
    endHydration,
    getSSRContext,
    isHydrating,
    isSSREnvironment,
    startHydration,
    szv,
    verifyMangleMapIntegrity,
} from '@csszyx/runtime';
// === Runtime Lite (minimal bundle) ===
export { _sz as _szLite, _szIf as _szIfLite } from '@csszyx/runtime/lite';
// === Types ===
export type {
    CsszyxConfig,
    DevelopmentConfig,
    PartialCsszyxConfig,
    ProductionConfig,
    RecoveryManifest,
    SzProp,
    SzProps,
} from '@csszyx/types';
// === Unplugin ===
export {
    esbuildPlugin,
    rollupPlugin,
    unplugin,
    vitePlugin,
    webpackPlugin,
} from '@csszyx/unplugin';

// === JSX Type Augmentation ===
// Triple-slash reference: extends React.HTMLAttributes and React.SVGAttributes
// with the `sz` prop so users get IntelliSense without tsconfig changes.
/// <reference types="@csszyx/types/jsx" />

// === Default Export ===
// Universal plugin for auto-detection
export { unplugin as default } from '@csszyx/unplugin';
