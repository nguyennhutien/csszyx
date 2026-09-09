/**
 * Defects the generated harnesses have found and that are recorded rather than
 * fixed, so the suites stay green while the record can only shrink.
 *
 * The same idiom as `KNOWN_DIVERGENCES` in `parity_corpus.rs`: a listed case
 * that starts behaving fails the suite just as loudly as an unlisted case that
 * starts misbehaving. A record nobody is forced to maintain becomes a place
 * bugs go to be forgotten.
 */
import type { SzObject } from '../../../compiler/src/transform-core.js';

/**
 * Keys whose STRING-valued form loses its variant prefix in the TypeScript
 * engine: `{ sm: { toPos: '300px' } }` lowers to `to-[300px]` there and to
 * `sm:to-[300px]` through Rust.
 *
 * Cause: a literal `includePrefix = false` on the string branches of
 * `collectEffectStringProperty` in `transform-core.ts`. It is a defect, not a
 * policy — the same key keeps its prefix when the value is numeric
 * (`{ sm: { toPos: 50 } }` → `sm:to-50%`) or an object
 * (`{ sm: { shadowColor: { color: 'blue-500', op: 50 } } }` → `sm:shadow-…`),
 * and `insetShadowColor` keeps its prefix where `shadowColor` drops it. No
 * ordering of those three facts describes a rule.
 *
 * The TS engine is the one that ships to the browser, through
 * `@csszyx/runtime/lowering`, so the effect is a build-time/runtime split: the
 * same object lowers with its responsive prefix at build time and without it
 * when the value is computed at runtime. Fixing it changes shipped class output
 * for these keys, which is why it is recorded here instead of patched by the
 * change that found it.
 */
export const PREFIX_DROP_KEYS: readonly string[] = [
    'backdropBrightness',
    'backdropContrast',
    'backdropSaturate',
    'brightness',
    'contrast',
    'fromPos',
    'saturate',
    'scale',
    'shadowColor',
    'toPos',
    'viaPos',
];

/** Fast membership test for the recorded keys. */
export const PREFIX_DROP_KEY_SET: ReadonlySet<string> = new Set(PREFIX_DROP_KEYS);

/**
 * One string-valued probe per recorded key, so a "can only shrink" check does
 * not depend on a random stream happening to reach that key.
 */
export const PREFIX_DROP_PROBES: readonly (readonly [string, SzObject])[] = [
    ['backdropBrightness', { sm: { backdropBrightness: '1.25' } }],
    ['backdropContrast', { sm: { backdropContrast: '1.5' } }],
    ['backdropSaturate', { sm: { backdropSaturate: '1.5' } }],
    ['brightness', { sm: { brightness: '1.5' } }],
    ['contrast', { sm: { contrast: '1.5' } }],
    ['fromPos', { sm: { fromPos: '300px' } }],
    ['saturate', { sm: { saturate: '1.5' } }],
    ['scale', { sm: { scale: '1.5' } }],
    ['shadowColor', { sm: { shadowColor: 'blue-500' } }],
    ['toPos', { sm: { toPos: '300px' } }],
    ['viaPos', { sm: { viaPos: '300px' } }],
];
