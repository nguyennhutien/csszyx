/**
 * Escapes what `JSON.stringify` leaves dangerous when its output is spliced
 * into JavaScript source.
 *
 * `JSON.stringify` escapes for JSON, not for a program: it passes `<`, `>` and
 * the U+2028/U+2029 line separators through untouched, so a value containing
 * `</script>` breaks out of a script tag and a raw separator ends the line for
 * a parser. This is the escape CodeQL's own `js/bad-code-sanitization` help
 * prescribes, character for character, so the barrier is the recognised one
 * rather than a hand-rolled equivalent.
 *
 * The result is the same value: `"<"` reads back as `<`, so a probe
 * source means exactly what the object it came from meant.
 */
const UNSAFE_IN_SOURCE: Readonly<Record<string, string>> = {
    '<': String.raw`\u003C`,
    '>': String.raw`\u003E`,
    '\u2028': String.raw`\u2028`,
    '\u2029': String.raw`\u2029`,
};

/**
 * Makes a JSON string safe to splice into JavaScript source.
 *
 * The set is the measured one rather than the illustrative one. CodeQL's help
 * for this rule lists the control characters too, but none of them can reach
 * here: `JSON.stringify` escapes every code point below U+0020, so the only
 * raw control character it ever emits is U+007F, which is not a line
 * terminator and not a delimiter. Sweeping the whole BMP through
 * `JSON.stringify` leaves exactly `<`, `>`, U+2028 and U+2029 raw and
 * meaningful to a parser — and a narrower class is also what keeps this
 * readable to the repository's own lint rules, which reject both `[\b]` and
 * `[\u0008]` inside a character class.
 *
 * `/` is deliberately absent, as it is from CodeQL's own regex: it is harmless
 * on its own, and the `</script>` case it belongs to is already closed by
 * escaping `<`.
 *
 * @param json Output of `JSON.stringify`.
 * @returns The same value, with the characters a JS parser reacts to escaped.
 */
export function escapeUnsafeChars(json: string): string {
    return json.replace(/[<>\u2028\u2029]/g, character => UNSAFE_IN_SOURCE[character] as string);
}
