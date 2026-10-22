/**
 * A value written as a JavaScript literal, for a test that builds source text
 * from data: `JSON.stringify`, with every character that can end the
 * surrounding context written as an escape instead.
 *
 * `JSON.stringify` alone is not enough there. `<` and `>` close a JSX
 * element or an inline `<script>`, `/` completes a `</script>`, and U+2028 and
 * U+2029 end a line in the JavaScript that predates ES2019. Each one becomes a
 * `\uXXXX` escape: the parsed value is the same string, and the text cannot
 * leave the expression it was written into.
 *
 * @module js-literal
 */

/** The escape each context-ending character is written as. */
const ESCAPES = {
    '<': '\\u003C',
    '>': '\\u003E',
    '/': '\\u002F',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
};

/**
 * Write `value` as a JavaScript literal that stays inside the expression it is
 * placed in.
 *
 * @param {unknown} value - A JSON-serialisable value.
 * @returns {string} The literal: `JSON.stringify(value)` with `<`, `>`, `/`,
 *   U+2028 and U+2029 escaped.
 */
export function jsLiteral(value) {
    return JSON.stringify(value).replace(
        /[<>/\u2028\u2029]/g,
        character => ESCAPES[/** @type {keyof typeof ESCAPES} */ (character)],
    );
}
