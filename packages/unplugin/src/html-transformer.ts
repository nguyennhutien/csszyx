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
import { sortStrings } from './sort.js';
import { replaceEveryLiteral, unicodeEscape } from './string-escape.js';

const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);

/**
 * Escape JSON for safe embedding inside an HTML `<script>` tag.
 *
 * `JSON.stringify` alone does not protect against `</script>`, HTML
 * comment introducers, or CDATA terminators appearing in user-controlled
 * map values. Escaping the leading character of each sequence keeps the
 * payload parseable as JSON while preventing the browser HTML parser
 * from interpreting it as markup.
 *
 * @param value - The value to JSON-encode for script-tag embedding.
 * @param prettyPrint - When true, indent the JSON output by two spaces.
 * @returns Sanitized JSON string safe to inline inside `<script>...</script>`.
 */
export function safeJsonForScriptTag(value: unknown, prettyPrint = false): string {
    const json = prettyPrint ? JSON.stringify(value, null, 2) : JSON.stringify(value);
    let escaped = replaceEveryLiteral(json, '<', unicodeEscape('003C'));
    escaped = replaceEveryLiteral(escaped, '>', unicodeEscape('003E'));
    escaped = replaceEveryLiteral(escaped, '&', unicodeEscape('0026'));
    escaped = replaceEveryLiteral(escaped, LINE_SEPARATOR, unicodeEscape('2028'));
    return replaceEveryLiteral(escaped, PARAGRAPH_SEPARATOR, unicodeEscape('2029'));
}

/**
 * Carrier for the inert hydration census — DATA, never executable code.
 *
 * `script` is a `<script type="application/json">` data block: browsers do
 * not evaluate it and a `script-src` policy does not apply to it. It is the
 * form `@csszyx/runtime`'s hydration verification reads back from the DOM.
 * csszyx emits no executable inline script at all; this is the whole of what
 * it puts in the document besides the checksum attribute.
 */
/**
 * HTML injection options.
 */
export interface HtmlInjectionOptions {
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
/**
 * Insert `attr` immediately after the `<html` of the first `<html …>` opening
 * tag (before any existing attributes), or return the html unchanged when no
 * such tag exists. Linear indexOf scan replacing `/<html([^>]*)>/i`, whose
 * `[^>]*` re-scanned from each `<html` position when no `>` followed.
 *
 * @param html - Source HTML.
 * @param attr - Attribute text to insert (must include its own leading space).
 * @returns The html with the attribute inserted, or unchanged.
 */
function injectHtmlOpeningAttr(html: string, attr: string): string {
    const lower = html.toLowerCase();
    let from = 0;
    for (;;) {
        const start = lower.indexOf('<html', from);
        if (start === -1) {
            return html;
        }
        const after = html[start + 5];
        // Only a real `<html` tag: the next char ends the name (`>`, space, /).
        if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) {
            const close = html.indexOf('>', start + 5);
            if (close === -1) {
                return html;
            }
            const nameEnd = start + 5;
            return `${html.slice(0, nameEnd)}${attr}${html.slice(nameEnd)}`;
        }
        from = start + 5;
    }
}

/**
 * Inject the SSR hydration checksum onto the document's `<html>` tag.
 *
 * @param html - The HTML document.
 * @param checksum - The mangle-map checksum to embed.
 * @param minify - Use the short `data-sz-cs` attribute name instead of `data-sz-checksum`.
 * @returns The HTML with the checksum attribute on `<html>` (unchanged when absent).
 */
export function injectChecksum(html: string, checksum: string, minify = false): string {
    const attrName = minify ? 'data-sz-cs' : 'data-sz-checksum';
    return injectHtmlOpeningAttr(html, ` ${attrName}="${checksum}"`);
}

/**
 * Put a `<script>` tag at the end of the document head.
 *
 * Both injectors place a JSON data block that a runtime reads back by id, and
 * both have to cope with HTML that a framework may have emitted without a
 * head, or without a closing `</html>` — a fragment rendered into a shell,
 * for instance. Where the tag lands decides whether the runtime finds it, so
 * the rule is written once rather than kept in step in two places.
 *
 * @param html - HTML content.
 * @param scriptTag - The tag to insert.
 * @returns The HTML with the tag inserted.
 */
function withScriptTag(html: string, scriptTag: string): string {
    if (html.includes('</head>')) {
        return html.replace('</head>', `${scriptTag}\n</head>`);
    }
    if (html.includes('</html>')) {
        return html.replace('</html>', `${scriptTag}\n</html>`);
    }
    return html + scriptTag;
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
    const scriptTag = `<script id="__CSSZYX_MANGLE_MAP__" type="application/json">${safeJsonForScriptTag(checksumMap, prettyPrint)}</script>`;

    return withScriptTag(html, scriptTag);
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
    const { minify = false } = options;

    let result = injectChecksum(html, checksum, minify);
    result = injectMangleMapScript(result, mangleMap, options);

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
    const sortedKeys = sortStrings(tokens.keys());
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

    return withScriptTag(html, scriptTag);
}
