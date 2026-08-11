/**
 * csszyx — the entry browsers resolve to, via the `browser` export condition.
 *
 * The main entry re-exports the compiler and the bundler plugins. Both reach
 * Node-only code (`@csszyx/core/native`, `oxc-parser`, `node:fs`), and a
 * bundler fails at RESOLVE, before tree-shaking can drop what an app never
 * calls — so client code could not import the umbrella at all, no matter which
 * names it asked for.
 *
 * This entry carries only what a browser can actually run: the runtime helpers
 * and the type surface. `index.ts` re-exports it and adds the Node-only names
 * on top, which keeps the two in step and makes the node entry a strict
 * superset by construction rather than by a second hand-kept list.
 *
 * Not to be confused with `browser.ts`, which is the standalone `<script>`-tag
 * IIFE served over CDN and exports nothing.
 *
 * Deliberately absent: `@csszyx/core`'s WASM exports. wasm-bindgen's bundler
 * target calls `__wbindgen_start()` at load, so naming the module pulls the
 * binary in whole — measured at ~337 kB on top of a runtime-only bundle — and
 * no bundler can shake it back out.
 */

// === Runtime Helpers ===
// === Variant Authoring ===
// === Hydration & SSR ===
export {
    _sz,
    _sz2,
    _sz3,
    _szMerge,
    abortHydration,
    endHydration,
    getSSRContext,
    isHydrating,
    isSSREnvironment,
    startHydration,
    szcn,
    szr,
    szv,
    verifyMangleMapIntegrity,
} from '@csszyx/runtime';
// === Runtime Lite (minimal bundle) ===
export { _sz as _szLite } from '@csszyx/runtime/lite';
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

// === JSX Type Augmentation ===
// Triple-slash reference: extends React.HTMLAttributes and React.SVGAttributes
// with the `sz` prop so users get IntelliSense without tsconfig changes.
/// <reference types="@csszyx/types/jsx" />
