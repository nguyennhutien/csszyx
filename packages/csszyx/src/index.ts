/**
 * csszyx - Universal CSS-in-JS for Tailwind CSS with WASM core.
 *
 * This is the main entry point that provides a unified API for:
 * - Core Rust WASM (encoding, mangling, checksum)
 * - Runtime helpers (_sz, _szMerge, lite bundle)
 * - Compiler logic (transform, manifest, recovery)
 * - Unplugin (Vite, Webpack, Rollup, esbuild)
 * - TypeScript types
 *
 * Everything below the runtime layer is Node-only, so bundlers resolving under
 * the `browser` condition get `index.browser.ts` instead. That file owns the
 * app-facing names and is re-exported here, which is what makes this entry a
 * strict superset of it — a second copy of the list would drift, and once did:
 * `szr`/`szcn` were documented as importable from `csszyx` while missing from
 * this file for several releases.
 */

// === Compiler ===
export {
    type SzObject,
    serializeManifest,
    transform,
    transformSource,
    validateSzRecover,
} from '@csszyx/compiler';
// === Core WASM ===
export {
    compute_mangle_checksum,
    encode,
    transform_sz,
    verify_mangle_checksum,
} from '@csszyx/core';
// === Unplugin ===
export {
    esbuildPlugin,
    rollupPlugin,
    unplugin,
    vitePlugin,
    webpackPlugin,
} from '@csszyx/unplugin';
// === Runtime helpers, hydration, variant authoring, types ===
export * from './index.browser.js';

// === JSX Type Augmentation ===
// Triple-slash reference: extends React.HTMLAttributes and React.SVGAttributes
// with the `sz` prop so users get IntelliSense without tsconfig changes.
/// <reference types="@csszyx/types/jsx" />

// === Default Export ===
// Universal plugin for auto-detection
export { unplugin as default } from '@csszyx/unplugin';
