/**
 * Minimal, dependency-free HTML escaping for the generated Tailwind-scanner
 * files. Shared so the Next safelist writer and the base safelist writer escape
 * class tokens identically. The structural HTML copy is escaped for safe
 * nesting; a separate scanner-only section preserves exact candidate bytes.
 */

/**
 * Escape a string for safe interpolation into an HTML double-quoted attribute.
 *
 * @param value - the raw string (e.g. a space-joined class list).
 * @returns the string with HTML-sensitive characters replaced by entities.
 */
export function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Marker separating structural HTML from exact Tailwind scanner candidates. */
export const RAW_SAFELIST_MARKER = '<!-- csszyx exact scanner candidates -->';

/**
 * Render source-authored class tokens exactly as Tailwind's byte scanner expects.
 *
 * The generated safelist is a build artifact, never browser content. Each value
 * has already been tokenized by the compiler, so newlines provide unambiguous
 * scanner boundaries without applying HTML or JavaScript string escaping.
 *
 * @param classNames Ordered class candidates.
 * @returns Marker-prefixed raw candidate lines.
 */
export function renderTailwindScannerCandidates(classNames: readonly string[]): string {
    return `${RAW_SAFELIST_MARKER}\n${classNames.join('\n')}\n`;
}
