/**
 * Minimal, dependency-free HTML escaping for the generated Tailwind-scanner
 * files. Shared so the Next safelist writer and the base safelist writer escape
 * class tokens identically. Only attribute-breaking characters are escaped:
 * Tailwind arbitrary variants use raw `&` and `>` as syntax, and its scanner
 * reads source bytes rather than decoding HTML entities.
 */

/**
 * Escape a string for safe interpolation into an HTML double-quoted attribute.
 *
 * @param value - the raw string (e.g. a space-joined class list).
 * @returns the string with `"` and `<` replaced by their entities.
 */
export function escapeHtmlAttribute(value: string): string {
    return value.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
