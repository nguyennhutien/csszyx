/**
 * React integration for @csszyx/dynamic.
 *
 * Provides:
 * - sz: direct alias for dynamic() (cleaner import in React files)
 * - useSz(): hook returning stable { sz } object with cleanup on unmount
 * - CsszyxProvider: optional context for custom manifest URL
 *
 * @example
 * // Simple usage
 * import { sz } from '@csszyx/dynamic/react';
 * const cls = sz({ p: 4, bg: 'blue-500' });
 *
 * @example
 * // Hook usage (recommended — handles manifest + cleanup automatically)
 * import { useSz } from '@csszyx/dynamic/react';
 * function FormField({ schema }) {
 *     const { sz } = useSz();
 *     return <div className={sz(schema.style)}>{schema.label}</div>;
 * }
 *
 * @example
 * // Custom manifest URL
 * import { CsszyxProvider } from '@csszyx/dynamic/react';
 * <CsszyxProvider manifest="/assets/csszyx-manifest.json">
 *     <App />
 * </CsszyxProvider>
 */

import type { SzObject } from '@csszyx/compiler/browser';
import {
    createContext,
    createElement,
    type ReactElement,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
} from 'react';

import { dynamic } from './index.js';
import { cleanup as injectorCleanup } from './injector.js';
import { preloadManifest, resetManifest, setManifestUrl } from './manifest.js';

// ── Context ───────────────────────────────────────────────────────────────────

/**
 *
 */
interface CsszyxContextValue {
    manifestUrl: string;
}

const CsszyxContext = createContext<CsszyxContextValue>({
    manifestUrl: '/csszyx-manifest.json',
});

// ── sz alias ──────────────────────────────────────────────────────────────────

/**
 * Runtime alias for dynamic(). Use in React files for consistency with
 * the build-time `sz` prop: `sz={{ p: 4 }}` at build, `sz({ p: 4 })` at runtime.
 */
export const sz = dynamic;

// ── useSz hook ────────────────────────────────────────────────────────────────

/**
 *
 */
export interface UseSzReturn {
    /**
     * Converts sz props to a class string, injecting CSS for new classes.
     * Stable reference — safe to pass as a prop without useMemo.
     */
    sz: (props: SzObject) => string;
}

/**
 * Deferred cleanup timer — shared across all useSz instances.
 *
 * WHY DEFERRED: React 18 StrictMode fires useEffect cleanup immediately after
 * the initial mount (simulating unmount → remount to catch side-effect bugs).
 * Without deferral, the first mount injects CSS → StrictMode cleanup fires →
 * CSS is wiped → no re-render → component renders with no styles.
 *
 * With setTimeout(0): StrictMode's cleanup schedules removal, then StrictMode's
 * remount runs synchronously and cancels the timer before it fires. On a true
 * navigation away, no remount happens, so the timer fires and cleans up.
 */
let _cleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * React hook for runtime dynamic styling.
 *
 * Returns a stable `{ sz }` object. Preloads the manifest on mount.
 * On unmount, releases CSSStyleSheet tiers and manifest cache — deferred
 * to survive React 18 StrictMode's double-mount/unmount cycle.
 *
 * @returns stable object containing the sz function for converting sz props to class strings
 * @example
 * const { sz } = useSz();
 * return <div className={sz(apiResponse.field.style)} />;
 */
export function useSz(): UseSzReturn {
    const { manifestUrl } = useContext(CsszyxContext);
    const stableSz = useCallback((props: SzObject) => dynamic(props), []);

    useEffect(() => {
        // Cancel any pending cleanup from a previous unmount (handles StrictMode remount).
        if (_cleanupTimer !== null) {
            clearTimeout(_cleanupTimer);
            _cleanupTimer = null;
        }
        // Pre-fetch manifest (non-blocking)
        preloadManifest(manifestUrl);

        return () => {
            // Defer cleanup so a StrictMode remount can cancel it before it fires.
            _cleanupTimer = setTimeout(() => {
                injectorCleanup();
                resetManifest();
                _cleanupTimer = null;
            }, 0);
        };
    }, [manifestUrl]);

    return { sz: stableSz };
}

// ── CsszyxProvider ────────────────────────────────────────────────────────────

/**
 *
 */
interface CsszyxProviderProps {
    /** Custom manifest URL (default: '/csszyx-manifest.json'). */
    manifest: string;
    children: ReactNode;
}

/**
 * Optional React context for custom manifest path or non-root deployments.
 * Without Provider, dynamic() defaults to fetching /csszyx-manifest.json.
 *
 * @param props - component props
 * @param props.manifest - URL to the csszyx manifest JSON file
 * @param props.children - child React nodes to render within the provider
 * @returns React element wrapping children in a CsszyxContext.Provider
 * @example
 * <CsszyxProvider manifest="/api/assets/csszyx-manifest.json">
 *     <App />
 * </CsszyxProvider>
 */
export function CsszyxProvider({ manifest, children }: CsszyxProviderProps): ReactElement {
    useEffect(() => {
        setManifestUrl(manifest);
        preloadManifest(manifest);
    }, [manifest]);

    return createElement(
        CsszyxContext.Provider,
        { value: { manifestUrl: manifest } },
        children,
    );
}
