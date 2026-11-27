/**
 * What `dynamic()` reads a class's value with, shared with the lowering's
 * reports: the slash opacity and its modifier, the shadow-value test, and
 * the type Tailwind infers for a bracket. Its own entry so the browser
 * lowering, which reads the first two only in development, ships none of it,
 * and only re-exports, so the root, which imports the first two, loads none of
 * the type reading.
 *
 * @module
 */

export { inferDataType } from './arbitrary-data-type.js';
export { isShadowValue, SHADOW_SIZE_KEYWORDS } from './shadow-size-keywords.js';
export { isBackgroundGradientString, modifierOp, slashOpacitySplit } from './slash-opacity.js';
