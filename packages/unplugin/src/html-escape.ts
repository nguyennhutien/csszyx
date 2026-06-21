/**
 * Minimal, dependency-free HTML escaping for the generated Tailwind-scanner
 * files. Shared so the Next safelist writer and the base safelist writer escape
 * class tokens identically — a class token must not be able to break out of the
 * `class="…"` attribute (or the surrounding element) and inject markup into the
 * file Tailwind scans.
 */

/**
 * Escape a string for safe interpolation into an HTML double-quoted attribute.
 *
 * @param value - the raw string (e.g. a space-joined class list).
 * @returns the string with `&`, `"`, `<`, `>` replaced by their entities.
 */
export function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
