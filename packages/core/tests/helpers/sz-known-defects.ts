/**
 * Defects the generated harnesses have found and that are recorded rather than
 * fixed, so the suites stay green while the record can only shrink.
 *
 * The same idiom as `KNOWN_DIVERGENCES` in `parity_corpus.rs`: a listed case
 * that starts behaving fails the suite just as loudly as an unlisted case that
 * starts misbehaving. A record nobody is forced to maintain becomes a place
 * bugs go to be forgotten — so the lists stay here, empty, rather than the
 * mechanism being deleted along with its last entry.
 *
 * ## What this held, and where it went
 *
 * Eleven keys — `backdropBrightness`, `backdropContrast`, `backdropSaturate`,
 * `brightness`, `contrast`, `fromPos`, `saturate`, `scale`, `shadowColor`,
 * `toPos`, `viaPos` — dropped their variant prefix in the TypeScript engine
 * when, and only when, the value was a string. The differential harness found
 * them on its first run, from generated input; the record here kept the suites
 * honest until the fix landed. The behaviour is now pinned by example in
 * `packages/compiler/tests/variant-prefix-string-values.test.ts`, so emptying
 * these lists loses no coverage.
 */
import type { SzObject } from '../../../compiler/src/transform-core.js';

/**
 * Keys whose string-valued form is known to lower differently in the
 * TypeScript engine than in the Rust one.
 *
 * Empty, and meant to stay that way. Adding an entry is how a harness records
 * a divergence it cannot fix in the same change; every entry must name why the
 * fix belongs elsewhere.
 */
export const PREFIX_DROP_KEYS: readonly string[] = [];

/** Fast membership test for the recorded keys. */
export const PREFIX_DROP_KEY_SET: ReadonlySet<string> = new Set(PREFIX_DROP_KEYS);

/**
 * One probe per recorded key, so a "can only shrink" check does not depend on
 * a random stream happening to reach that key.
 */
export const PREFIX_DROP_PROBES: readonly (readonly [string, SzObject])[] = [];
