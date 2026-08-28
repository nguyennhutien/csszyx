/**
 * Escaping for JSON that gets pasted into generated JavaScript — inline
 * `<script>` bodies and template literals.
 *
 * `JSON.stringify` output is valid JS, but pasting it into a template
 * literal or a script tag adds two grammars the JSON layer knows nothing
 * about. Mangle-map keys are class names, and arbitrary-value classes can
 * carry any character (`[content:'...']`), so a key containing a backtick,
 * `${`, or `</script` would otherwise terminate the surrounding construct
 * and turn style data into executable code.
 *
 * All replacements rewrite characters that only occur inside JSON string
 * values into `\uXXXX` escapes, which are valid (and equivalent) in both
 * JSON and every JavaScript string context — so the result still parses
 * identically wherever the original JSON was legal.
 * @module
 */

import { escapeDoubleQuotedString, replaceEveryLiteral, unicodeEscape } from './string-escape.js';

const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);

/**
 * Makes a JSON string safe to embed in inline scripts and template literals.
 * @param json - Output of `JSON.stringify`.
 * @returns The same JSON with template-literal and script-tag terminators
 * rewritten as unicode escapes.
 */
export function escapeJsonForInlineScript(json: string): string {
    let escaped = replaceEveryLiteral(json, '`', unicodeEscape('0060'));
    escaped = replaceEveryLiteral(escaped, '$', unicodeEscape('0024'));
    escaped = replaceEveryLiteral(escaped, '<', unicodeEscape('003c'));
    escaped = replaceEveryLiteral(escaped, LINE_SEPARATOR, unicodeEscape('2028'));
    return replaceEveryLiteral(escaped, PARAGRAPH_SEPARATOR, unicodeEscape('2029'));
}

/**
 * Make a JSON payload safe inside a JavaScript STRING LITERAL of any quoting.
 *
 * A payload that starts life in a template literal does not stay in one: a
 * minifier is free to re-quote it, and Next's production build did exactly
 * that — the hydration census went in between backticks and came out between
 * double quotes, where its own `"` characters closed the string and the
 * server chunk died with `Unexpected token 'class'`.
 *
 * So escape every character that could terminate or alter a string literal in
 * ANY quoting — the three quotes, the backslash that would eat a following
 * escape, and `$` which only matters in a template literal — plus the
 * script-tag and line-terminator hazards. `\uXXXX` escapes are valid in every
 * JavaScript string context and decode to the original character at runtime,
 * so the value the browser sees is byte-identical JSON whatever the minifier
 * chose.
 *
 * @param json - Output of `JSON.stringify`, already JSON-level escaped.
 * @returns The same JSON, safe in a single-, double- or backtick-quoted literal.
 */
export function escapeJsonForStringLiteral(json: string): string {
    // Backslash FIRST: every later replacement introduces backslashes of its
    // own, and escaping them again would double them.
    let escaped = replaceEveryLiteral(json, '\\', unicodeEscape('005c'));
    for (const [character, code] of [
        ['"', '0022'],
        ["'", '0027'],
        ['`', '0060'],
        ['$', '0024'],
        ['<', '003c'],
        ['>', '003e'],
        [LINE_SEPARATOR, '2028'],
        [PARAGRAPH_SEPARATOR, '2029'],
    ] as const) {
        escaped = replaceEveryLiteral(escaped, character, unicodeEscape(code));
    }
    return escaped;
}

/**
 * Escape a string for embedding inside a double-quoted JavaScript string
 * literal. Webpack dev mode wraps each module as `eval("…module source…")`,
 * so a string spliced into that module is parsed twice: once as the outer
 * `eval` string, then as the module. Escaping only `"` is incomplete — any
 * backslash in the input (e.g. the `<`-style escapes from
 * `escapeJsonForInlineScript`) would be consumed by the outer string parse,
 * undoing the escaping. Escape backslashes first, then quotes, so the value
 * survives the extra parse byte-for-byte.
 * @param value - The string to embed (already JSON/inline-script safe).
 * @returns The string with backslashes and double quotes escaped.
 */
export function escapeForDoubleQuotedString(value: string): string {
    return escapeDoubleQuotedString(value);
}
