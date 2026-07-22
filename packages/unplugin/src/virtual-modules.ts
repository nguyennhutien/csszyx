/**
 * Virtual module system for csszyx mangle map.
 *
 * Provides a virtual module that exposes the mangle map at runtime,
 * enabling SSR/CSR hydration verification.
 *
 * @module virtual-modules
 */

/**
 * Virtual module ID for mangle map.
 */
export const VIRTUAL_MODULE_ID = 'virtual:csszyx/mangle-map';

/**
 * Resolved virtual module ID (with null byte prefix for unplugin).
 */
export const RESOLVED_VIRTUAL_MODULE_ID: string = `\0${VIRTUAL_MODULE_ID}`;

/**
 * Virtual module ID for szcn theme groups: auto-generated from the app's
 * `@theme` blocks so custom tokens (colors, text sizes, font families/weights)
 * join szcn's merge groups with zero wiring.
 */
export const THEME_GROUPS_VIRTUAL_ID = 'virtual:csszyx/theme-groups';

/** Resolved theme-groups virtual module ID (null-byte prefixed). */
export const RESOLVED_THEME_GROUPS_VIRTUAL_ID: string = `\0${THEME_GROUPS_VIRTUAL_ID}`;

import type { CssVariableMangleValue } from '@csszyx/compiler';

/** CSS variable mangling and hoisting metrics exposed for debugging. */
export interface CSSVariableMetrics {
    componentClassUses: number;
    componentStyleDeclarations: number;
    estimatedHoistedDeclarationsSaved: number;
    scopedClassUses: number;
    scopedStyleDeclarations: number;
}

/**
 * Virtual module ID for checksum only.
 */
export const VIRTUAL_CHECKSUM_ID = 'virtual:csszyx/checksum';

/**
 * Resolved virtual checksum module ID.
 */
export const RESOLVED_VIRTUAL_CHECKSUM_ID: string = `\0${VIRTUAL_CHECKSUM_ID}`;

/**
 * Creates the mangle map virtual module content.
 *
 * @param {Record<string, string>} mangleMap - The mangle map (original -> mangled)
 * @param {string} checksum - SHA-256 checksum of the mangle map
 * @param varMangleMap CSS variable mangle map. Values can be arrays when one
 * original dynamic variable is emitted with both scoped and hoisted names.
 * @param cssVarMetrics CSS variable hoisting metrics.
 * @returns {string} Module source code
 *
 * @example
 * ```typescript
 * const source = createMangleMapModule(
 *   { 'p-4': 'z', 'bg-red-500': 'y' },
 *   'a1b2c3d4e5f67890'
 * );
 * // Returns:
 * // export const mangleMap = {"p-4":"z","bg-red-500":"y"};
 * // export const checksum = "a1b2c3d4e5f67890";
 * ```
 */
export function createMangleMapModule(
    mangleMap: Record<string, string>,
    checksum: string,
    varMangleMap: Record<string, CssVariableMangleValue> = {},
    cssVarMetrics: CSSVariableMetrics | null = null,
): string {
    return `/**
 * Auto-generated mangle map for csszyx.
 * This module is generated at build time and contains the mapping
 * from original class names and CSS variable names to mangled names.
 *
 * @generated
 */

export const mangleMap = ${JSON.stringify(mangleMap, null, 2)};

export const varMangleMap = ${JSON.stringify(varMangleMap, null, 2)};

export const cssVarMetrics = ${JSON.stringify(cssVarMetrics, null, 2)};

export const checksum = ${JSON.stringify(checksum)};

export default {
  mangleMap,
  varMangleMap,
  cssVarMetrics,
  checksum,
};
`;
}

/**
 * Creates the checksum-only virtual module content.
 *
 * @param {string} checksum - SHA-256 checksum of the mangle map
 * @returns {string} Module source code
 */
export function createChecksumModule(checksum: string): string {
    return `/**
 * Auto-generated checksum for csszyx mangle map.
 *
 * @generated
 */

export const checksum = ${JSON.stringify(checksum)};

export default checksum;
`;
}

/**
 * Checks if a module ID is a csszyx virtual module.
 *
 * @param {string} id - Module ID to check
 * @returns {boolean} True if it's a csszyx virtual module
 */
export function isVirtualModule(id: string): boolean {
    return (
        id === VIRTUAL_MODULE_ID ||
        id === VIRTUAL_CHECKSUM_ID ||
        id === THEME_GROUPS_VIRTUAL_ID ||
        id === MANGLE_RUNTIME_VIRTUAL_ID
    );
}

/**
 * Resolves a virtual module ID to its prefixed version.
 *
 * @param {string} id - Module ID to resolve
 * @returns {string | undefined} Resolved ID or undefined if not a virtual module
 */
export function resolveVirtualModule(id: string): string | undefined {
    if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
    }
    if (id === VIRTUAL_CHECKSUM_ID) {
        return RESOLVED_VIRTUAL_CHECKSUM_ID;
    }
    if (id === THEME_GROUPS_VIRTUAL_ID) {
        return RESOLVED_THEME_GROUPS_VIRTUAL_ID;
    }
    if (id === MANGLE_RUNTIME_VIRTUAL_ID) {
        return RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID;
    }
    return undefined;
}

/**
 * Virtual module ID for the self-installing runtime mangle map. Unlike
 * {@link VIRTUAL_MODULE_ID} (opt-in data exports for hydration verification),
 * this module is imported for its SIDE EFFECT: it installs `window.__csszyx`
 * from inside the JS bundle itself, so the runtime encode map reaches ANY host
 * page that loads the bundle — embedded builds whose HTML csszyx never
 * transforms, and CSP setups that strip inline scripts (field-reported: a
 * hybrid app served by a host shell shipped mangled CSS while `szr` had no map
 * to encode with, so runtime-resolved classes reached the DOM unmangled and
 * their styles silently vanished).
 */
export const MANGLE_RUNTIME_VIRTUAL_ID = 'virtual:csszyx/mangle-runtime';

/** Resolved runtime mangle-map virtual module ID (null-byte prefixed). */
export const RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID: string = `\0${MANGLE_RUNTIME_VIRTUAL_ID}`;

/**
 * Placeholders substituted with live mangle state during output processing,
 * AFTER the class-mangling passes have run over each chunk. Embedding the map
 * at module-load time is wrong twice over: the map is not final yet (modules
 * load while classes are still being discovered), and the mangle passes would
 * rewrite the embedded map's own keys as if they were class usage — observed
 * as a bundled map degenerating into identity entries.
 */
export const MANGLE_MAP_PLACEHOLDER = '___CSSZYX_MANGLE_MAP___';
export const VAR_MANGLE_MAP_PLACEHOLDER = '___CSSZYX_VAR_MANGLE_MAP___';
export const CHECKSUM_PLACEHOLDER = '___CSSZYX_CHECKSUM___';

/**
 * Generates the self-installing runtime mangle-map module. The module mirrors
 * the `window.__csszyx` object the HTML inline script installs (same fields,
 * same fail-safe lookups) and installs ONLY when no object exists yet. The
 * inline script always evaluates before deferred module code, and it is
 * emitted at the end of the build, so an existing object is always at least as
 * fresh as this module — never replace it.
 *
 * Browser-only by design: SSR mangle state travels through
 * `__csszyx_ssr_mangle_map`, which the SSR pipeline owns, so installing the
 * browser object on a server global must not happen here.
 *
 * The map data is emitted as {@link MANGLE_MAP_PLACEHOLDER} placeholders, not
 * live values: output processing substitutes the final map into every chunk
 * after the mangle passes, which keeps this module correct without caring
 * when the bundler chooses to load it.
 *
 * @param globalVarAliasPrefix - Prefix marking global CSS variable aliases.
 * @returns Module source code.
 */
export function createMangleRuntimeModule(globalVarAliasPrefix: string): string {
    return `/**
 * Auto-generated by csszyx: installs the runtime mangle map from the bundle.
 *
 * @generated
 */

const m = ${MANGLE_MAP_PLACEHOLDER};
const vm = ${VAR_MANGLE_MAP_PLACEHOLDER};
const gp = ${JSON.stringify(globalVarAliasPrefix)};
const checksum = "${CHECKSUM_PLACEHOLDER}";

if (typeof window !== 'undefined' && !window.__csszyx) {
    const r = {};
    const vr = {};
    for (const k in m) r[m[k]] = k;
    for (const vk in vm) {
        const vv = vm[vk];
        const vs = Array.isArray(vv) ? vv : [vv];
        for (const v of vs) (vr[v] || (vr[v] = [])).push(vk);
    }
    window.__csszyx = {
        mangleMap: m,
        varMangleMap: vm,
        checksum,
        decode: (c) => r[c],
        encode: (c) => m[c],
        decodeVar: (v) => vr[v] || [],
        encodeVar: (v) => vm[v],
        decodeGlobalVar: (v) => {
            const a = vr[v] || [];
            return v.indexOf(gp) === 0 ? a[0] : undefined;
        },
        decodeAll: (el) => (el.className || '').split(' ').map((c) => r[c] || c),
    };
}

export {};
`;
}

/** Theme token names per szcn merge-group category (see @csszyx/runtime). */
export interface ThemeGroupTokens {
    colors: readonly string[];
    textSizes: readonly string[];
    fontFamilies: readonly string[];
    fontWeights: readonly string[];
}

/**
 * Generates the theme-groups virtual module: one idempotent
 * `registerSzcnGroups` call carrying the app's `@theme` token names, so szcn
 * can dedupe classes built from custom tokens with zero app wiring. The import
 * is injected into every app module that uses szcn, which means the SAME
 * registration runs in every bundle that can call szcn (client, SSR, edge) —
 * keeping merge results, and therefore rendered classNames, identical across
 * environments.
 *
 * @param {ThemeGroupTokens} tokens - Token names from the theme scan.
 * @returns {string} Module source.
 */
export function createThemeGroupsModule(tokens: ThemeGroupTokens): string {
    const payload = JSON.stringify({
        colors: tokens.colors,
        textSizes: tokens.textSizes,
        fontFamilies: tokens.fontFamilies,
        fontWeights: tokens.fontWeights,
    });
    return [
        '// Auto-generated by csszyx from the @theme blocks in scanned CSS.',
        "import { registerSzcnGroups } from '@csszyx/runtime';",
        `registerSzcnGroups(${payload});`,
        'export {};',
    ].join('\n');
}
