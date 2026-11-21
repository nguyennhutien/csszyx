/**
 * A string that spells a plain decimal number: `'4'`, `'-2'`, `'2.5'`, `'.5'`.
 *
 * The static lowering (`numericStringValue` in `transform-core.ts`) and the
 * runtime value helpers (`spacing-var.ts`) read the same strings as numbers,
 * so `{ p: '.5' }` and `p: x` with `x = '.5'` agree. Rust: `spells_decimal` in
 * `lower.rs`. A leaf module, so importing it pulls nothing else into a chunk.
 *
 * Linear in the string's length: one optional sign, then digits with at most
 * one point, with no nested quantifier.
 */
export const NUMERIC_STRING: RegExp = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
