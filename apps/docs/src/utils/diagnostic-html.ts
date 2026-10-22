/**
 * Registry text as HTML: escaped, never parsed as markup, with the backtick
 * code spans the registry writes turned into `<code>`.
 */

/**
 * Escape text for an HTML text node or a double-quoted attribute.
 *
 * @param text - Any text.
 * @returns The escaped text.
 */
export function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

/**
 * Inline `code` spans written with backticks, the way the registry writes them.
 *
 * @param text - Escaped text.
 * @returns The text with each backtick span wrapped in `<code>`.
 */
export function withCode(text: string): string {
    return text.replaceAll(/`([^`]+)`/g, '<code>$1</code>');
}
