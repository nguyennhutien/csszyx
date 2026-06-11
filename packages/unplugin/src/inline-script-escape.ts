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

/**
 * Makes a JSON string safe to embed in inline scripts and template literals.
 * @param json - Output of `JSON.stringify`.
 * @returns The same JSON with template-literal and script-tag terminators
 * rewritten as unicode escapes.
 */
export function escapeJsonForInlineScript(json: string): string {
    return json
        .replace(/`/g, '\\u0060') // backtick — ends a template literal
        .replace(/\$/g, '\\u0024') // blocks ${...} interpolation
        .replace(/</g, '\\u003c') // blocks </script> tag breakout
        .replace(/\u2028/g, '\\u2028') // line separator — legal JSON, risky JS
        .replace(/\u2029/g, '\\u2029'); // paragraph separator — same
}
