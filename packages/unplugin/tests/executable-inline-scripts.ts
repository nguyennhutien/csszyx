/**
 * The one reader for "what executable inline script does this HTML carry".
 *
 * This is the assertion the CSP contract rests on, so it is written once and
 * shared. The tag matching is deliberately liberal: HTML tag names are
 * case-insensitive and a close tag may carry anything up to its `>` — spaces,
 * tabs, newlines, even an attribute — so a filter that only recognises the
 * exact lowercase spelling reports a clean page for `<SCRIPT>`, `</script >`
 * or a close tag with junk before the bracket. That is a filter that fails open, which for this
 * assertion means a build could start emitting executable script and every
 * test would still pass.
 *
 * NOT a `.test.ts` file: vitest must not collect it.
 */

/**
 * Every `<script>` in the document that a `script-src 'self'` policy would
 * refuse: inline, meaning no `src`, and executable, meaning no `type` or a
 * JavaScript one.
 *
 * `type="application/json"` data blocks are not scripts to CSP and are not
 * returned; a blanket `<script` assertion would flag the inert census csszyx
 * emits on purpose.
 *
 * @param html - the document to read.
 * @returns the bodies of the executable inline scripts, in document order.
 */
export function executableInlineScripts(html: string): string[] {
    const found: string[] = [];
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script[^>]*>/gi)) {
        const attrs = match[1];
        if (/\bsrc\s*=/i.test(attrs)) continue;
        const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.trim().toLowerCase();
        const executable =
            type === undefined ||
            type === '' ||
            type === 'module' ||
            type === 'text/javascript' ||
            type === 'application/javascript';
        if (executable) found.push(match[2]);
    }
    return found;
}
