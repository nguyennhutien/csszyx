/**
 * HTML transformation for csszyx SSR hydration.
 *
 * Injects mangle map checksum and map data into HTML templates
 * for client-side verification during hydration.
 *
 * @module html-transformer
 */

import { createHash } from 'node:crypto';

import type { TokenData } from '@csszyx/compiler';

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

/**
 * Recovery manifest emitted to SSR HTML so `@csszyx/runtime/verify` can
 * match `data-sz-recovery-token` attributes against valid build-time
 * tokens. Mirrors the runtime's `RecoveryManifest` interface verbatim.
 */
export interface RecoveryManifest {
    /**
     * Identifier unique per build. Used by the runtime to detect
     * stale manifests after a redeploy. Time-based + hash-suffixed so
     * concurrent builds in the same millisecond still differ.
     */
    buildId: string;
    /**
     * SHA-256 of the canonicalised tokens object, truncated to 16 hex
     * chars. Lets the runtime detect tampering without needing the full
     * digest. Truncation is acceptable here — the manifest is integrity-
     * checked, not cryptographically signed.
     */
    checksum: string;
    /**
     * Map from 12-char token (the value also written into the matching
     * element's `data-sz-recovery-token` attribute) to the metadata the
     * runtime uses for verification + error reporting.
     */
    tokens: Record<string, TokenData>;
}

/**
 * Build a {@link RecoveryManifest} from the in-memory token map the
 * unplugin accumulates across all transformed files.
 *
 * Tokens are sorted alphabetically before serialisation so the resulting
 * checksum is stable across runs that produce the same set of tokens
 * (otherwise Map iteration order would surface differently per build).
 *
 * @param tokens Per-build token map collected from `transformSourceCode`.
 * @returns Manifest object ready to JSON.stringify.
 */
export function buildRecoveryManifest(
    tokens: Map<string, TokenData>,
): RecoveryManifest {
    const sorted: Record<string, TokenData> = {};
    const sortedKeys = [...tokens.keys()].sort();
    for (const key of sortedKeys) {
        const data = tokens.get(key);
        if (data) {
            sorted[key] = data;
        }
    }

    const serialised = JSON.stringify(sorted);
    const fullChecksum = createHash('sha256').update(serialised).digest('hex');
    const checksum = fullChecksum.substring(0, 16);
    const buildId = `${Date.now().toString(36)}-${fullChecksum.substring(0, 6)}`;

    return { buildId, checksum, tokens: sorted };
}

/**
 * Inject the recovery manifest as a JSON `<script>` tag into the HTML head.
 * The element id `__SZ_RECOVERY_MANIFEST__` is the contract `loadManifestFromDOM`
 * in `@csszyx/runtime/verify` reads back at hydration time.
 *
 * No-op when the manifest has zero tokens (avoid leaking an empty script
 * tag into pages that never use szRecover).
 *
 * @param html Raw HTML content.
 * @param manifest Manifest produced by {@link buildRecoveryManifest}.
 * @returns Modified HTML, or unchanged if there are no tokens.
 */
export function injectRecoveryManifest(
    html: string,
    manifest: RecoveryManifest,
): string {
    if (Object.keys(manifest.tokens).length === 0) {
        return html;
    }

    const json = JSON.stringify(manifest);
    const scriptTag = `<script id="__SZ_RECOVERY_MANIFEST__" type="application/json">${json}</script>`;

    if (html.includes('</head>')) {
        return html.replace('</head>', `${scriptTag}\n</head>`);
    } else if (html.includes('</html>')) {
        return html.replace('</html>', `${scriptTag}\n</html>`);
    }
    return html + scriptTag;
}
