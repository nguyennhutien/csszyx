/**
 * Which sz key a Tailwind prefix belongs to when the prefix belongs to several.
 *
 * `REVERSE_PROPERTY_MAP` used to be a hand-written inversion of the compiler's
 * `PROPERTY_MAP`. Measured, 87% of it fell out of that inversion with no choice
 * to make, and copying those entries by hand is what let the two drift: the
 * copy was missing `rotate-x` and `border-bs`, so `rotate-x-45` migrated to
 * `rotate: 'x-45'` and `border-bs-2` to `borderColor: 'bs-2'` — a colour key
 * holding a width. Both still lowered back to the right class, which is why
 * nothing caught them.
 *
 * So the mechanical part is generated now, and this file holds the part that
 * is a decision. When several sz keys lower to one prefix, the inversion has
 * no way to pick, and picking is knowledge about which meaning is the common
 * one — `text-` is far more often a colour than a text-align.
 *
 * The choice made here is only the DEFAULT. `class-parser.ts` looks at the
 * value and overrides it: `text-center` reaches `textAlign` because `center`
 * is an align keyword, not because of anything in this table.
 *
 * @module
 */

/**
 * The default sz key for a prefix several keys share.
 *
 * Every entry must name a key that `PROPERTY_MAP` actually lowers to this
 * prefix; `pnpm gen:reverse-map:check` fails if one does not, so a key renamed
 * in the compiler cannot leave a stale choice behind.
 */
export const AMBIGUOUS_PREFIX_CHOICE: Record<string, string> = {
    // Colour wins on every prefix that takes one: a colour is the common
    // reason to write these, and the other meanings are keyword values that
    // class-parser recognises by their value.
    bg: 'bg',
    text: 'color',
    border: 'border',
    'border-t': 'borderT',
    'border-r': 'borderR',
    'border-b': 'borderB',
    'border-l': 'borderL',
    'border-x': 'borderX',
    'border-y': 'borderY',
    divide: 'divideColor',
    outline: 'outline',
    ring: 'ring',
    'ring-offset': 'ringOffset',
    'inset-ring': 'insetRing',
    decoration: 'decoration',
    shadow: 'shadow',
    'inset-shadow': 'insetShadow',
    'text-shadow': 'textShadow',
    'drop-shadow': 'dropShadow',
    stroke: 'stroke',

    // `font-` splits between weight and family; weight is the far more common
    // authoring choice, and family names are caught by value.
    font: 'weight',

    // The remaining shorthands: the bare prefix means the primary property,
    // and the secondary one is reached through its own keyword values.
    object: 'objectFit',
    list: 'list',
    flex: 'flex',
    transition: 'transition',
    snap: 'snapType',

    // `transform-*` is a value form of `transform` (`transform-gpu`,
    // `transform-none`); `transformStyle` owns `transform-style-*` instead.
    transform: 'transform',

    // Logical inset shorthands. `start`/`end` are the classes Tailwind emits,
    // and they are listed in EXTRA_REVERSE_PREFIXES; these are the `inset-`
    // spellings of the same thing.
    'inset-s': 'insetS',
    'inset-e': 'insetE',
};

/**
 * Prefixes migrate must understand that no `PROPERTY_MAP` entry produces.
 *
 * These are Tailwind class roots whose sz key lowers under a different prefix,
 * so inverting the forward table cannot reach them. They are few and each one
 * needs its own reason, which is why they are written out rather than derived.
 */
export const EXTRA_REVERSE_PREFIXES: Record<string, string> = {
    // `bgSize` lowers to the bare `bg-` prefix, so the inversion files it under
    // `bg`. Tailwind still spells the class `bg-size-*` in its arbitrary form.
    'bg-size': 'bgSize',
    // `insetS`/`insetE` lower to `inset-s`/`inset-e`, but Tailwind's bare
    // logical inset classes are `start-*` and `end-*`.
    start: 'insetS',
    end: 'insetE',
    // A plugin utility with no compiler-side property entry.
    prose: 'prose',
};

/**
 * Prefixes the inversion must skip because their lowering is special-cased.
 *
 * The inversion assumes a class reads as `prefix-value`, which is what makes
 * stripping the prefix give back the sz value. A handful of keys do not lower
 * that way, and for those the assumption produces a migration that compiles to
 * a DIFFERENT class than the one it started from.
 *
 * Every entry here is measured, not guessed: `mask-repeat-x` would strip to
 * `maskRepeat: 'x'`, which lowers to `mask-x`. The value the class carries is
 * `repeat-x`, not `x`, so class-parser has to read it by value.
 *
 * Adding a key to this list is a claim that the round trip is broken, and the
 * sz-key matrix in `sz-key-matrix.test.ts` is what proves or disproves it.
 */
export const SPECIAL_LOWERING_PREFIXES: Record<string, string> = {
    // `mask-repeat-x` carries the value `repeat-x`, not `x`; `mask-repeat` is
    // also the class for the value `repeat`, so the prefix is a whole class.
    'mask-repeat': 'maskRepeat lowers by value, not by prefix plus value',
};
