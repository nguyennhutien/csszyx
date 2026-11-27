/**
 * The CSS units csszyx reads a number with. Its own module so the lowering,
 * the engine's generated table and `dynamic()`'s reading of a bracket read one
 * list, and each ships only the list.
 *
 * @module
 */

/**
 * Every unit a numeric value can carry, which no bare class does: CSS Values 4
 * lengths (font-relative, viewport, container query, absolute), angles, times
 * and `fr`. The engine's `needs_brackets` reads this set, generated.
 */
export const ARBITRARY_LENGTH_UNITS: ReadonlySet<string> = new Set([
    'px',
    'rem',
    'em',
    '%',
    'ex',
    'rex',
    'cap',
    'rcap',
    'ch',
    'rch',
    'ic',
    'ric',
    'lh',
    'rlh',
    'vw',
    'vh',
    'vi',
    'vb',
    'vmin',
    'vmax',
    'svw',
    'svh',
    'svi',
    'svb',
    'svmin',
    'svmax',
    'lvw',
    'lvh',
    'lvi',
    'lvb',
    'lvmin',
    'lvmax',
    'dvw',
    'dvh',
    'dvi',
    'dvb',
    'dvmin',
    'dvmax',
    'cqw',
    'cqh',
    'cqi',
    'cqb',
    'cqmin',
    'cqmax',
    'cm',
    'mm',
    'in',
    'pt',
    'pc',
    'Q',
    'deg',
    'rad',
    'turn',
    'grad',
    'ms',
    's',
    'fr',
]);
