/**
 * HTML transformation for csszyx SSR hydration.
 *
 * Injects mangle map checksum and map data into HTML templates
 * for client-side verification during hydration.
 *
 * @module html-transformer
 */

/**
 * Injection mode for mangle map.
 */
export type InjectionMode = 'inline' | 'script' | 'both';

/**
 * HTML injection options.
 */
export interface HtmlInjectionOptions {
  /**
   * How to inject the mangle map.
   * - 'inline': As data-sz-map attribute on <html>
   * - 'script': As <script id="__CSSZYX_MANGLE_MAP__"> in <head>
   * - 'both': Both methods
   *
   * @default 'script'
   */
  mode?: InjectionMode;

  /**
   * Whether to pretty-print JSON in script tag.
   *
   * @default false
   */
  prettyPrint?: boolean;

  /**
   * Minify attributes (use short names).
   *
   * @default true in production
   */
  minify?: boolean;
}

/**
 * Injects checksum into HTML <html> tag.
 *
 * @param {string} html - HTML content
 * @param {string} checksum - SHA-256 checksum (16-char hex)
 * @param {boolean} minify - Use short attribute names
 * @returns {string} Modified HTML
 *
 * @example
 * ```typescript
 * const html = '<html lang="en"><head></head></html>';
 * const result = injectChecksum(html, 'a1b2c3d4e5f67890');
 * // <html lang="en" data-sz-checksum="a1b2c3d4e5f67890"><head></head></html>
 * ```
 */
export function injectChecksum(
    html: string,
    checksum: string,
    minify = false,
): string {
    const attrName = minify ? 'data-sz-cs' : 'data-sz-checksum';

    // Find <html> tag and inject checksum
    const htmlTagPattern = /<html([^>]*)>/i;
    const match = html.match(htmlTagPattern);

    if (!match) {
    // No <html> tag found, return unchanged
        return html;
    }

    const existingAttrs = match[1];
    const checksumAttr = ` ${attrName}="${checksum}"`;

    // Replace <html...> with <html data-sz-checksum="..." ...>
    return html.replace(
        htmlTagPattern,
        `<html${checksumAttr}${existingAttrs}>`,
    );
}

/**
 * Injects mangle map as a script tag in HTML.
 *
 * @param {string} html - HTML content
 * @param {Record<string, string>} mangleMap - Mangle map
 * @param {HtmlInjectionOptions} options - Injection options
 * @returns {string} Modified HTML
 *
 * @example
 * ```typescript
 * const html = '<html><head></head><body></body></html>';
 * const map = { 'p-4': 'z', 'bg-red-500': 'y' };
 * const result = injectMangleMapScript(html, map);
 * // <html><head>
 * //   <script id="__CSSZYX_MANGLE_MAP__" type="application/json">
 * //     {"p-4":"z","bg-red-500":"y"}
 * //   </script>
 * // </head><body></body></html>
 * ```
 */
export function injectMangleMapScript(
    html: string,
    mangleMap: Record<string, string>,
    options: HtmlInjectionOptions = {},
): string {
    const { prettyPrint = false } = options;

    const jsonContent = prettyPrint
        ? JSON.stringify(mangleMap, null, 2)
        : JSON.stringify(mangleMap);

    const scriptTag = `<script id="__CSSZYX_MANGLE_MAP__" type="application/json">${jsonContent}</script>`;
    const debugScript = `<script>(function(){var m=${jsonContent};var r={};for(var k in m)r[m[k]]=k;var cs=document.documentElement.getAttribute("data-sz-checksum")||"";window.__csszyx={mangleMap:m,checksum:cs,decode:function(c){return r[c]},encode:function(c){return m[c]},decodeAll:function(el){return(el.className||"").split(" ").map(function(c){return r[c]||c})}}})()</script>`;

    // Inject before </head> or before </html> if no head
    const combined = `${scriptTag}\n${debugScript}`;
    if (html.includes('</head>')) {
        return html.replace('</head>', `${combined}\n</head>`);
    } else if (html.includes('</html>')) {
        return html.replace('</html>', `${combined}\n</html>`);
    }

    // No closing tags found, append at the end
    return html + combined;
}

/**
 * Injects mangle map as data attribute on <html> tag.
 *
 * @param {string} html - HTML content
 * @param {Record<string, string>} mangleMap - Mangle map
 * @param {boolean} minify - Use short attribute names
 * @returns {string} Modified HTML
 *
 * @example
 * ```typescript
 * const html = '<html><head></head></html>';
 * const map = { 'p-4': 'z' };
 * const result = injectMangleMapAttribute(html, map);
 * // <html data-sz-map='{"p-4":"z"}'><head></head></html>
 * ```
 */
export function injectMangleMapAttribute(
    html: string,
    mangleMap: Record<string, string>,
    minify = false,
): string {
    const attrName = minify ? 'data-sz-m' : 'data-sz-map';
    const jsonContent = JSON.stringify(mangleMap);

    const htmlTagPattern = /<html([^>]*)>/i;
    const match = html.match(htmlTagPattern);

    if (!match) {
        return html;
    }

    const existingAttrs = match[1];
    const mapAttr = ` ${attrName}='${jsonContent}'`;

    return html.replace(htmlTagPattern, `<html${mapAttr}${existingAttrs}>`);
}

/**
 * Injects both checksum and mangle map into HTML.
 *
 * @param {string} html - HTML content
 * @param {Record<string, string>} mangleMap - Mangle map
 * @param {string} checksum - SHA-256 checksum
 * @param {HtmlInjectionOptions} options - Injection options
 * @returns {string} Modified HTML
 *
 * @example
 * ```typescript
 * const html = '<html><head></head><body></body></html>';
 * const map = { 'p-4': 'z', 'bg-red-500': 'y' };
 * const checksum = 'a1b2c3d4e5f67890';
 * const result = injectHydrationData(html, map, checksum);
 * ```
 */
export function injectHydrationData(
    html: string,
    mangleMap: Record<string, string>,
    checksum: string,
    options: HtmlInjectionOptions = {},
): string {
    const { mode = 'script', minify = false } = options;

    let result = html;

    // Always inject checksum
    result = injectChecksum(result, checksum, minify);

    // Inject mangle map based on mode
    if (mode === 'inline') {
        result = injectMangleMapAttribute(result, mangleMap, minify);
    } else if (mode === 'script') {
        result = injectMangleMapScript(result, mangleMap, options);
    } else if (mode === 'both') {
        result = injectMangleMapAttribute(result, mangleMap, minify);
        result = injectMangleMapScript(result, mangleMap, options);
    }

    return result;
}

/**
 * Vite-specific HTML transformation hook.
 *
 * @param {string} html - HTML content
 * @param {Record<string, string>} mangleMap - Mangle map
 * @param {string} checksum - SHA-256 checksum
 * @param {HtmlInjectionOptions} options - Injection options
 * @returns {string} Modified HTML
 */
export function transformIndexHtml(
    html: string,
    mangleMap: Record<string, string>,
    checksum: string,
    options: HtmlInjectionOptions = {},
): string {
    return injectHydrationData(html, mangleMap, checksum, options);
}
