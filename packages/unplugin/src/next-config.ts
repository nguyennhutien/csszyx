/**
 * Next.js Turbopack config helper for csszyx.
 *
 * Wires the `turbopack` block correctly so apps avoid the two known foot-guns:
 *
 * 1. The `*.tsx` loader rule must **not** set `as`. csszyx is a same-type
 *    `.tsx -> .tsx` transform; `as: '*.tsx'` makes the loader output re-match
 *    its own rule and Turbopack resolves imports to `./X.tsx.tsx`
 *    (`Module not found`). This helper omits `as`.
 * 2. The transform injects `import { _szMerge } from '@csszyx/runtime'`. A
 *    Turbopack loader cannot resolve bare specifiers (no `resolveId` hook), and
 *    under strict package managers the transitive runtime is not importable by
 *    name, so this helper aliases `@csszyx/runtime` to its resolved path.
 *
 * @module
 */
import { createRequire } from 'node:module';

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
    const { glob = '*.tsx', parserMode = 'rust', safelistOutputFile, config } = options;

    const loaderOptions: Record<string, unknown> = { parserMode };
    if (safelistOutputFile !== undefined) {
        loaderOptions.safelistOutputFile = safelistOutputFile;
    }
    if (config !== undefined) {
        loaderOptions.config = config;
    }

    const resolveAlias: Record<string, string> = { ...(existing.resolveAlias ?? {}) };
    if (resolveAlias['@csszyx/runtime'] === undefined) {
        try {
            const require = createRequire(import.meta.url);
            resolveAlias['@csszyx/runtime'] = require.resolve('@csszyx/runtime');
        } catch {
            // Not resolvable from here — the @csszyx/runtime peerDependency
            // (auto-installed by pnpm/npm) and the install docs cover resolution.
        }
    }

    return {
        ...existing,
        rules: {
            ...(existing.rules ?? {}),
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
        resolveAlias,
    };
}
