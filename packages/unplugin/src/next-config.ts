/**
 * Next.js Turbopack config helper for csszyx.
 *
 * Wires the `turbopack` block so apps avoid the Turbopack foot-guns:
 *
 * 1. The `*.tsx` loader rule must **not** set `as`. csszyx is a same-type
 *    `.tsx -> .tsx` transform; `as: '*.tsx'` makes the loader output re-match
 *    its own rule and Turbopack resolves imports to `./X.tsx.tsx`
 *    (`Module not found`). This helper omits `as`.
 * 2. `config` defaults to `{ mangleVars: false }` to match what
 *    `csszyx next prebuild` bakes into the production manifest hash; a mismatch
 *    fails the loader's config-hash gate ("config hash changed").
 *
 * The transform also injects a bare `import { _szMerge } from '@csszyx/runtime'`.
 * That cannot be fixed from here — a Turbopack `resolveAlias` to an absolute path
 * is treated as project-relative and breaks — so **`@csszyx/runtime` must be a
 * direct dependency of the app** (it is declared as a peer dependency; add it to
 * your `package.json`). See the installation docs.
 *
 * @module
 */

/** Options forwarded to the csszyx Next Turbopack loader. */
export interface CsszyxTurbopackOptions {
    /** Parser lane for the loader. Defaults to `'rust'` (the shipped default). */
    parserMode?: 'rust' | 'oxc';
    /**
     * Safelist HTML path Tailwind `@source` reads. Must match the
     * `csszyx next prebuild --output-file` / `csszyx next watch` path.
     */
    safelistOutputFile?: string;
    /** Extra csszyx config forwarded to the loader (e.g. `{ mangleVars: false }`). */
    config?: Record<string, unknown>;
    /** Glob the loader applies to. Defaults to `'*.tsx'` (whole app). */
    glob?: string;
    /**
     * Compile a plain exported sz object into the modules that import it.
     *
     * On unless set. Whatever it is here, the prebuild must resolve it the
     * same way — it writes the safelist for the classes the loader emits, so a
     * lane that resolves more than the other emits class names with no rule.
     * To turn it off, pass `false` here AND `--no-imported-static-sz` to
     * `csszyx next prebuild` and `csszyx next watch`.
     */
    importedStaticSz?: boolean;
}

/** Minimal shape of a Next.js `turbopack` config block (only what we touch). */
export interface TurbopackConfig {
    rules?: Record<string, unknown>;
    resolveAlias?: Record<string, string>;
    [key: string]: unknown;
}

/**
 * Merge csszyx's Turbopack loader rule + runtime alias into an existing
 * `turbopack` config, preserving the caller's own `rules` / `resolveAlias`.
 *
 * @param existing - the caller's current `turbopack` config (preserved + merged).
 * @param options - csszyx loader options.
 * @returns a `turbopack` config to assign to `next.config`'s `turbopack` field.
 *
 * @example
 * // next.config.mjs
 * import { csszyxTurbopack } from '@csszyx/unplugin/next';
 * export default {
 *   turbopack: csszyxTurbopack(
 *     { resolveAlias: { 'maplibre-gl': 'maplibre-gl/dist/maplibre-gl.js' } },
 *     { safelistOutputFile: '.csszyx/next-loader-classes.html' },
 *   ),
 * };
 */
export function csszyxTurbopack(
    existing: TurbopackConfig = {},
    options: CsszyxTurbopackOptions = {},
): TurbopackConfig {
    const { glob = '*.tsx', parserMode = 'rust', safelistOutputFile } = options;
    // Must match `csszyx next prebuild`'s default (it bakes { mangleVars: false }
    // into the production manifest hash) or the loader's config-hash gate fails.
    const config = options.config ?? { mangleVars: false };

    const loaderOptions: Record<string, unknown> = { parserMode, config };
    if (options.importedStaticSz !== undefined) {
        loaderOptions.importedStaticSz = options.importedStaticSz;
    }
    if (safelistOutputFile !== undefined) {
        loaderOptions.safelistOutputFile = safelistOutputFile;
    }

    // `...existing` preserves the caller's own `resolveAlias` (e.g. maplibre).
    // We intentionally do NOT alias @csszyx/runtime — see the module doc.
    return {
        ...existing,
        rules: {
            ...existing.rules,
            [glob]: {
                loaders: [
                    {
                        loader: '@csszyx/unplugin/next-turbo-loader',
                        options: loaderOptions,
                    },
                ],
                // No `as` field — same-type .tsx -> .tsx transform.
            },
        },
    };
}
