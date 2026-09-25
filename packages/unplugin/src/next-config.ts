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
    /** Parser lane for the loader — the native addon or its wasm build.
     * Defaults to `'rust'` (the shipped default). */
    parserMode?: 'rust' | 'wasm';
    /**
     * Safelist path Tailwind `@source` reads. Must match the
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
    /**
     * Drop a class a later one on the same element covers, as the other lanes
     * spell `build.mergeCoveredClasses`. On unless set; `false` keeps every
     * class in static output, as before 0.18.
     */
    mergeCoveredClasses?: boolean;
    /**
     * The stylesheets the app loads, relative to the app root, when the
     * project also holds others: a fixture or an old copy that sets another
     * Tailwind prefix. Pass the same list to `csszyx next prebuild` and
     * `csszyx next watch` as `--tailwind-stylesheet`.
     */
    tailwindStylesheet?: string | string[];
    /**
     * The `turbopack` config this one extends: the caller's own `rules` and
     * `resolveAlias` are kept and csszyx's are merged in beside them.
     */
    turbopack?: TurbopackConfig;
}

/** Keep runtime key validation exhaustive when the typed options change. */
const OPTION_KEYS = new Set(
    Object.keys({
        parserMode: true,
        safelistOutputFile: true,
        config: true,
        glob: true,
        importedStaticSz: true,
        mergeCoveredClasses: true,
        tailwindStylesheet: true,
        turbopack: true,
    } satisfies Record<keyof CsszyxTurbopackOptions, true>),
);

/** What the helper says when Turbopack settings are outside the options object. */
const LEGACY_CALL_MESSAGE = [
    '[csszyx] csszyxTurbopack takes one object: the config to extend goes in it, under `turbopack`.',
    '  help: csszyxTurbopack({ turbopack: <your config>, ...options }) — put loader options beside `turbopack`.',
].join('\n');

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
 * Everything is one object, loader options and the config to extend alike.
 * With the config first and the options second, `TurbopackConfig` has an index
 * signature, so `csszyxTurbopack({ tailwindStylesheet })` type-checked, mixed
 * the option into the Turbopack config and left the loader without it.
 * Validation visits only top-level option keys, O(k) for k keys; it never
 * traverses nested config. This cost is paid once while evaluating Next config.
 *
 * @param options - csszyx loader options, and the config to extend.
 * @param rest - nothing; a second argument is what the previous shape took.
 * @returns a `turbopack` config to assign to `next.config`'s `turbopack` field.
 * @throws {Error} When passed extra arguments or unrecognized top-level options.
 *
 * @example
 * // next.config.mjs
 * import { csszyxTurbopack } from '@csszyx/unplugin/next';
 * export default {
 *   turbopack: csszyxTurbopack({
 *     turbopack: { resolveAlias: { 'maplibre-gl': 'maplibre-gl/dist/maplibre-gl.js' } },
 *     tailwindStylesheet: 'app/globals.css',
 *   }),
 * };
 */
export function csszyxTurbopack(
    options: CsszyxTurbopackOptions = {},
    // `never[]` rejects a second argument where the types are read, and the
    // throw catches the call that reaches here anyway: a config written in
    // plain JavaScript would otherwise lose that argument in silence, which
    // is the failure this shape exists to remove.
    ...rest: never[]
): TurbopackConfig {
    if (rest.length > 0 || Object.keys(options).some(key => !OPTION_KEYS.has(key))) {
        throw new Error(LEGACY_CALL_MESSAGE);
    }
    const existing = options.turbopack ?? {};
    const { glob = '*.tsx', parserMode = 'rust', safelistOutputFile } = options;
    // Must match `csszyx next prebuild`'s default (it bakes { mangleVars: false }
    // into the production manifest hash) or the loader's config-hash gate fails.
    const config = options.config ?? { mangleVars: false };

    const loaderOptions: Record<string, unknown> = { parserMode, config };
    if (options.importedStaticSz !== undefined) {
        loaderOptions.importedStaticSz = options.importedStaticSz;
    }
    if (options.mergeCoveredClasses !== undefined) {
        loaderOptions.mergeCoveredClasses = options.mergeCoveredClasses;
    }
    if (safelistOutputFile !== undefined) {
        loaderOptions.safelistOutputFile = safelistOutputFile;
    }
    if (options.tailwindStylesheet !== undefined) {
        loaderOptions.tailwindStylesheet = options.tailwindStylesheet;
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
