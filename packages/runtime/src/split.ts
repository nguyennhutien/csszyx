/**
 * The className-only half of the class toolkit, published as
 * `@csszyx/runtime/split`.
 *
 * `classify`/`has`/`pick`/`omit`/`splitBox` take a className STRING and answer
 * from the generated box-role table. Their sz-object siblings
 * (`classifySzKey`, `splitBoxSz`, …) answer the same questions about an sz
 * object, which needs the compiler's key vocabulary. This entry publishes the
 * first half without the second.
 *
 * It does NOT drop `@csszyx/compiler` from the graph: both halves live in one
 * module, whose top-level import of `isForbiddenSzKey` and friends survives
 * into `dist/split.cjs`. A bundler shakes it out of an ESM app; `require()`
 * does not. The win here is the shipped surface, not the dependency list.
 *
 * Measured with esbuild, minified, `NODE_ENV=production`, both entries from the
 * same build. Under ESM the barrel already tree-shakes and this entry saves
 * almost nothing — 7 239 B gzip against 7 312 B. The payoff is on the CJS path,
 * where `require()` cannot shake at all: 25 167 B against 31 242 B, 19% less.
 * That is the reason this entry exists; the fact that ESM barely moves is the
 * reason a separate PACKAGE does not. It is a smaller entry, not a
 * dependency-free one — both halves live in one module, so `dist/split.cjs`
 * still requires `@csszyx/compiler/browser`.
 *
 * Of those 7 239 B, about 1.9 KB is the value classifier `classify` reads its
 * `property` from — the same tables `szcn` merges by, so an app already using
 * `szcn` pays nothing extra for it, and an app using only this entry pays it
 * once.
 *
 * The vocabulary is atomic Tailwind utilities. A custom utility declaring
 * several properties cannot be assigned one box role reliably; place it with
 * an explicit override instead. See https://csszyx.com/docs/box-model-splitbox/.
 *
 * @module @csszyx/runtime/split
 */

export {
    type BoxRole,
    type BoxSelector,
    type Classification,
    classify,
    has,
    // The token scanner the toolkit classifies with. Public so a caller asking
    // "is this a base-breakpoint token?" does not copy the bracket-depth walk —
    // copies cut `[&:hover]:w-4` at the inner colon.
    normalizeBase,
    omit,
    pick,
    type SplitBoxOptions,
    type SplitBoxResult,
    splitBox,
    stripVariant,
} from './split-box.js';
