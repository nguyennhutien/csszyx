/**
 * The className-only half of the class toolkit, published as
 * `@csszyx/runtime/split`.
 *
 * `classify`/`has`/`pick`/`omit`/`splitBox` take a className STRING and answer
 * from the generated box-role table. Their sz-object siblings
 * (`classifySzKey`, `splitBoxSz`, …) answer the same questions about an sz
 * object, which needs the compiler's key vocabulary — a dependency a project
 * that only ever writes Tailwind class strings should not have to resolve.
 * This entry publishes the first half without the second.
 *
 * Measured with esbuild, minified, `NODE_ENV=production`, both entries from the
 * same build. Under ESM the barrel already tree-shakes and this entry saves
 * almost nothing — 5 406 B gzip against 5 482 B. The payoff is on the CJS path,
 * where `require()` cannot shake at all: 22 552 B against 30 919 B, 27 % less.
 * That is the reason this entry exists; the fact that ESM barely moves is the
 * reason a separate PACKAGE does not.
 * See `.agent/decisions/0021-atomic-only-class-vocabulary.md`.
 *
 * The vocabulary is atomic Tailwind utilities — a class whose name states one
 * feature. A custom `@utility` that declares several properties at once is out
 * of scope by decision, not by omission; the same ADR says why.
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
