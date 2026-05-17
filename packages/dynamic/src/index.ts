/**
 * @csszyx/dynamic — Runtime CSS injection with delta check.
 *
 * Converts sz objects to Tailwind class strings at runtime, injecting CSS
 * only for classes not already present in the pre-built stylesheet.
 *
 * Architecture:
 *   Layer 1 (manifest):  Lazy-fetched JSON of all classes in built CSS.
 *   Layer 2 (generator): Tailwind class → CSS rule using v4 CSS var patterns.
 *   Layer 3 (injector):  21-tier CSSStyleSheet for correct breakpoint cascade.
 *
 * SSR-safe: on server, returns class names only — no CSSOM access.
 *
 * @example
 * // Framework-agnostic usage
 * import { dynamic, preloadManifest } from '@csszyx/dynamic';
 *
 * await preloadManifest('/csszyx-manifest.json'); // optional: eagerly load
 * const cls = dynamic({ p: 4, bg: 'blue-500' }); // → "p-4 bg-blue-500"
 */

// Import only the browser-safe (pure JS, no WASM) transform sub-path.
// The main '@csszyx/compiler' entry bundles @csszyx/core (WASM) which cannot
// run in browsers without a dedicated WASM loader.
import type { ReadonlySzObject, SzObject } from '@csszyx/compiler/browser';
import { transform } from '@csszyx/compiler/browser';

import { generateCSSRule } from './css-generator.js';
import { cleanup as injectorCleanup, injectRule, resolveTier } from './injector.js';
import {
    ensureManifest,
    lookupManifest,
    preloadManifest as manifestPreload,
    resetManifest,
} from './manifest.js';
import { isServer } from './ssr.js';

export type { ReadonlySzObject, SzObject } from '@csszyx/compiler/browser';
export type { Tier } from './css-generator.js';
export type { CSSManifest } from './manifest.js';

/**
 * Transforms sz props at runtime and injects CSS only for classes not already
 * in the pre-built stylesheet. Lazy-loads manifest on first call.
 *
 * SSR-safe: on server, returns class names without CSSOM access.
 *
 * @param szProps - sz object (e.g. { p: 4, bg: 'blue-500', hover: { bg: 'blue-600' } }). Accepts both mutable and `as const` objects.
 * @returns space-separated class string (e.g. "p-4 bg-blue-500 hover:bg-blue-600")
 *
 * @example
 * const cls = dynamic({ p: 4, bg: 'blue-500' });
 * // → "p-4 bg-blue-500" (injects CSS for classes not in built stylesheet)
 */
export function dynamic(szProps: SzObject | ReadonlySzObject): string {
    const { className } = transform(szProps as SzObject);
    if (!className) {
        return '';
    }

    if (isServer) {
        // SSR: apply the mangle map if the Vite plugin exposed it via globalThis.
        // The plugin sets __csszyx_ssr_mangle_map in buildEnd(), which runs before
        // SSG rendering (Astro, Next.js) in the same Node.js process. Without this,
        // dynamic() returns unmangled names (e.g. "p-4") while built CSS only has
        // mangled selectors (e.g. ".q0"), so styles silently don't apply in SSR HTML.
        const ssrMangleMap = (globalThis as Record<string, unknown>).__csszyx_ssr_mangle_map as
            | Record<string, string>
            | undefined;
        if (ssrMangleMap) {
            return className
                .split(' ')
                .filter(Boolean)
                .map(c => ssrMangleMap[c] ?? c)
                .join(' ');
        }
        return className;
    }

    // Trigger manifest lazy-load (non-blocking — first render uses whatever is loaded)
    ensureManifest();

    const classes = className.split(' ').filter(Boolean);
    const outputClasses: string[] = [];

    for (const cls of classes) {
        const manifestResult = lookupManifest(cls);

        if (manifestResult !== null) {
            // Class is in built CSS. Use the resolved name (mangled in production).
            outputClasses.push(manifestResult);
        } else {
            // Class is not in built CSS — inject CSS rule.
            const tier = resolveTier(cls);
            const rule = generateCSSRule(cls);
            injectRule(cls, rule, tier);
            outputClasses.push(cls);
        }
    }

    return outputClasses.join(' ');
}

/**
 * Eagerly preloads the CSS manifest.
 * Without this, the manifest is lazy-loaded on the first dynamic() call.
 * Call at app startup or on route enter for zero-latency first inject.
 *
 * @param url - manifest URL (default: '/csszyx-manifest.json')
 * @returns promise that resolves when the manifest has been fetched and cached
 * @example
 * await preloadManifest('/csszyx-manifest.json');
 */
export async function preloadManifest(url?: string): Promise<void> {
    return manifestPreload(url);
}

/**
 * Releases all CSSStyleSheet tiers from adoptedStyleSheets, clears the
 * injected class cache, and resets the manifest reference.
 *
 * Call on route unmount when the dynamic-styled component tree is destroyed.
 * Next dynamic() call will re-fetch the manifest and re-init sheets.
 *
 * @example
 * useEffect(() => {
 *     return () => cleanup();
 * }, []);
 */
export function cleanup(): void {
    injectorCleanup();
    resetManifest();
}
