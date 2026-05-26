/**
 * HTML transformation for csszyx SSR hydration.
 *
 * Injects mangle map checksum and map data into HTML templates
 * for client-side verification during hydration.
 *
 * @module html-transformer
 */

import { createHash } from 'node:crypto';

import type { CssVariableMangleValue, TokenData } from '@csszyx/compiler';

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

    /**
     * CSS custom property mangle map. Empty by default; when present, the
     * hydration checksum script includes both class and variable namespaces.
     */
    varMangleMap?: Record<string, CssVariableMangleValue>;
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
export function injectChecksum(html: string, checksum: string, minify = false): string {
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
    return html.replace(htmlTagPattern, `<html${checksumAttr}${existingAttrs}>`);
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
    const { prettyPrint = false, varMangleMap = {} } = options;
    const checksumMap = createHydrationMangleMap(mangleMap, varMangleMap);

    const jsonContent = prettyPrint
        ? JSON.stringify(checksumMap, null, 2)
        : JSON.stringify(checksumMap);
    const classMapContent = JSON.stringify(mangleMap);
    const varMapContent = JSON.stringify(varMangleMap);

    const scriptTag = `<script id="__CSSZYX_MANGLE_MAP__" type="application/json">${jsonContent}</script>`;
    const debugScript = `<script>(function(){var m=${classMapContent};var vm=${varMapContent};var r={};var vr={};for(var k in m)r[m[k]]=k;for(var vk in vm){var vv=vm[vk];var vs=Array.isArray(vv)?vv:[vv];for(var vi=0;vi<vs.length;vi++)(vr[vs[vi]]||(vr[vs[vi]]=[])).push(vk)}var cs=document.documentElement.getAttribute("data-sz-checksum")||"";window.__csszyx={mangleMap:m,varMangleMap:vm,checksum:cs,decode:function(c){return r[c]},encode:function(c){return m[c]},decodeVar:function(v){return vr[v]||[]},encodeVar:function(v){return vm[v]},decodeAll:function(el){return(el.className||"").split(" ").map(function(c){return r[c]||c})}}})()</script>`;

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
 * @param varMangleMap CSS variable mangle map. Values can be arrays when one
 * original dynamic variable is emitted with both scoped and hoisted names.
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
    varMangleMap: Record<string, CssVariableMangleValue> = {},
): string {
    const attrName = minify ? 'data-sz-m' : 'data-sz-map';
    const jsonContent = JSON.stringify(createHydrationMangleMap(mangleMap, varMangleMap));

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
        result = injectMangleMapAttribute(result, mangleMap, minify, options.varMangleMap);
    } else if (mode === 'script') {
        result = injectMangleMapScript(result, mangleMap, options);
    } else if (mode === 'both') {
        result = injectMangleMapAttribute(result, mangleMap, minify, options.varMangleMap);
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
 * Creates the map payload used by hydration checksum verification.
 *
 * Class-only builds return the historical class map unchanged. Builds with
 * variable mangling prefix both namespaces so class names and CSS custom
 * property names cannot collide inside the checksum input.
 *
 * @param classMap Original class name to mangled class token.
 * @param varMap Original CSS custom property to mangled property names.
 * @returns Mangle map payload for script/attribute injection.
 */
export function createHydrationMangleMap(
    classMap: Record<string, string>,
    varMap: Record<string, CssVariableMangleValue> = {},
): Record<string, string> {
    if (Object.keys(varMap).length === 0) {
        return classMap;
    }
    const payload: Record<string, string> = {};
    for (const [key, value] of Object.entries(classMap)) {
        payload[`class:${key}`] = value;
    }
    for (const [key, value] of Object.entries(varMap)) {
        if (Array.isArray(value)) {
            for (const mangled of value) {
                payload[`var:${key}:${mangled}`] = mangled;
            }
        } else {
            payload[`var:${key}`] = value;
        }
    }
    return payload;
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
     * SHA-256 checksum of the mangle map emitted into `data-sz-checksum`.
     * Kept separate from `checksum`, which protects the recovery token set.
     */
    mangleChecksum: string;
    /**
     * Map from 12-char token (the value also written into the matching
     * element's `data-sz-recovery-token` attribute) to the metadata the
     * runtime uses for verification + error reporting.
     */
    tokens: Record<string, TokenData>;
}

/**
 * Result of {@link buildRecoveryManifest}, including the manifest itself
 * plus any audit information the unplugin should surface to the user.
 */
export interface BuildRecoveryManifestResult {
    /** The manifest ready to inject into SSR HTML. */
    manifest: RecoveryManifest;
    /**
     * Source paths whose `dev-only` tokens were stripped from the
     * production manifest. Empty in development. The unplugin uses this
     * to emit a single rolled-up build warning rather than per-file
     * noise.
     */
    strippedDevOnlyPaths: string[];
}

/**
 * Build a {@link RecoveryManifest} from the in-memory token map the
 * unplugin accumulates across all transformed files.
 *
 * In production, `mode: 'dev-only'` tokens are stripped — the runtime
 * would reject them anyway (the recovery flag `__SZ_ALLOW_CSR_RECOVERY__`
 * is dev-mode only), and shipping them would leak dev-only authoring
 * intent into the production manifest. The visitor still emitted
 * `data-sz-recovery-token` attributes for those elements; that's a
 * deliberate trade-off — the runtime will reject the recovery, falling
 * back to whatever the framework's default mismatch behaviour is, which
 * is the correct outcome for an attribute that explicitly says "dev only".
 *
 * Tokens are sorted alphabetically before serialisation so the resulting
 * checksum is stable across runs that produce the same set of tokens
 * (otherwise Map iteration order would surface differently per build).
 *
 * @param tokens Per-build token map collected from `transformSourceCode`.
 * @param options Build options.
 * @param options.production When `true`, strip `mode: 'dev-only'` tokens
 *   from the manifest and report their source paths via
 *   `strippedDevOnlyPaths`. Defaults to `false` (development build).
 * @param options.mangleChecksum Mangle-map checksum emitted into the HTML
 *   `data-sz-checksum` attribute. Kept separate from the token checksum.
 * @returns Manifest + audit info (paths whose tokens were stripped).
 */
export function buildRecoveryManifest(
    tokens: Map<string, TokenData>,
    options: { production?: boolean; mangleChecksum: string },
): BuildRecoveryManifestResult {
    const stripped = options.production === true;
    const strippedDevOnlyPaths: string[] = [];

    const sorted: Record<string, TokenData> = {};
    const sortedKeys = [...tokens.keys()].sort();
    for (const key of sortedKeys) {
        const data = tokens.get(key);
        if (!data) {
            continue;
        }
        if (stripped && data.mode === 'dev-only') {
            strippedDevOnlyPaths.push(data.path);
            continue;
        }
        // Production manifests ship to every page that uses szRecover. The
        // `path` field carries `src/Button.tsx:5:8`-style references that
        // would let an attacker reverse-engineer the app's source tree
        // from a public manifest. The runtime never reads `path` for
        // verification — it's purely a devtools hint — so we strip it
        // in production. Dev builds keep the path for hover-to-source.
        sorted[key] = stripped ? { mode: data.mode, component: data.component, path: '' } : data;
    }

    const serialised = JSON.stringify(sorted);
    const fullChecksum = createHash('sha256').update(serialised).digest('hex');
    const checksum = fullChecksum.substring(0, 16);
    const buildId = `${Date.now().toString(36)}-${fullChecksum.substring(0, 6)}`;

    return {
        manifest: { buildId, checksum, mangleChecksum: options.mangleChecksum, tokens: sorted },
        strippedDevOnlyPaths,
    };
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
export function injectRecoveryManifest(html: string, manifest: RecoveryManifest): string {
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
