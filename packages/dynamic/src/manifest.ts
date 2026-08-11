/**
 * Manifest loading and caching.
 *
 * The manifest is a JSON file generated at build time by @csszyx/unplugin.
 * It lists all original class names present in the built CSS so runtime
 * dynamic() can skip injection for classes already covered.
 *
 * The manifest is fetched lazily on first dynamic() call (Qwik surgical pattern).
 * Never inlined into HTML — each page only pays the cost if dynamic() is used.
 */

/**
 *
 */
export interface CSSManifest {
    version: string;
    buildId: string;
    /** Original (non-mangled) class names present in built CSS. */
    classes: string[];
    /** Original → mangled map. Present only when production mangling is enabled. */
    mangleMap?: Record<string, string>;
}

// Module-level state (lazy, reset by cleanup())
let manifestClasses: Set<string> | null = null;
/** Classes answered from the manifest — the injections it spared. */
const manifestHits = new Set<string>();
/** Transfer size of the manifest as received, for the development report. */
let manifestBytes = 0;
let mangleMap: Record<string, string> | null = null;
let manifestUrl = '/csszyx-manifest.json';
let fetchPromise: Promise<void> | null = null;

/**
 * Override the manifest URL (called by CsszyxProvider).
 *
 * @param url - absolute or relative URL to the csszyx manifest JSON file
 */
export function setManifestUrl(url: string): void {
    manifestUrl = url;
}

/**
 * Returns true if the manifest has been loaded.
 *
 * @returns true once the manifest fetch has completed (even on failure)
 */
export function isManifestLoaded(): boolean {
    return manifestClasses !== null;
}

/**
 * Lazily fetches and caches the manifest.
 * Returns the in-flight promise so concurrent calls coalesce.
 *
 * @returns promise that resolves when the manifest is loaded (or silently fails)
 */
export function ensureManifest(): Promise<void> {
    if (manifestClasses !== null) {
        return Promise.resolve();
    }
    if (fetchPromise) {
        return fetchPromise;
    }

    fetchPromise = fetch(manifestUrl)
        .then(r => {
            if (!r.ok) {
                throw new Error(`csszyx: manifest fetch failed ${r.status}`);
            }
            return r.json() as Promise<CSSManifest>;
        })
        .then((data: CSSManifest) => {
            manifestClasses = new Set(data.classes);
            mangleMap = data.mangleMap ?? null;
            // Re-serializing is not the transfer size, but it is within a few
            // bytes of it and needs no header plumbing; the report says so.
            manifestBytes = JSON.stringify(data).length;
        })
        .catch(() => {
            // Non-blocking: if manifest unavailable, all classes are treated as
            // new, so dynamic() injects and the page still renders correctly.
            //
            // Final for the session, despite clearing the in-flight promise:
            // the guard above returns early once `manifestClasses` is set, so a
            // later call reuses this empty result rather than re-fetching. That
            // is deliberate — a missing manifest is the normal state when
            // `build.emitManifest` is off, and retrying it per dynamic() call
            // would put a failing request on the hot path. Call `resetManifest`
            // to try again.
            manifestClasses = new Set();
            mangleMap = null;
            fetchPromise = null;
        });

    return fetchPromise;
}

/**
 * Eagerly preloads the manifest. Call at app startup for zero-latency first inject.
 * Without this, the first dynamic() call triggers a lazy fetch.
 *
 * @param url - optional manifest URL override (default: '/csszyx-manifest.json')
 * @returns promise that resolves when the manifest has been fetched and cached
 */
export async function preloadManifest(url?: string): Promise<void> {
    if (url) {
        setManifestUrl(url);
    }
    return ensureManifest();
}

/**
 * Returns the CSS class name to use for a given original class name.
 *
 * - If manifest says the class is pre-built AND mangle map exists: returns mangled name.
 * - If manifest says the class is pre-built, no mangle map: returns original name.
 * - If class is NOT in manifest (or manifest not yet loaded): returns null (inject needed).
 *
 * @param originalClass - the original (non-mangled) Tailwind class name to look up
 * @returns the class name to use in the DOM (mangled or original), or null if injection is needed
 */
export function lookupManifest(originalClass: string): string | null {
    if (manifestClasses === null) {
        return null;
    } // not loaded yet
    if (!manifestClasses.has(originalClass)) {
        return null;
    } // not in built CSS

    // Class is in built CSS
    manifestHits.add(originalClass);
    if (mangleMap && originalClass in mangleMap) {
        return mangleMap[originalClass]; // return mangled name
    }
    return originalClass; // non-mangled build
}

/**
 * What the manifest has answered so far.
 *
 * Read by the development report, which weighs the file's transfer size against
 * the injections it spared. Kept here rather than exported as raw state so the
 * report cannot drift from the lookup that fills it.
 *
 * @returns Hit class names and the manifest's size in bytes.
 */
export function manifestSavings(): { hits: readonly string[]; bytes: number } {
    return { hits: [...manifestHits], bytes: manifestBytes };
}

/**
 * Releases all manifest state. Called by cleanup().
 * Next dynamic() call will re-fetch the manifest.
 */
export function resetManifest(): void {
    manifestClasses = null;
    mangleMap = null;
    fetchPromise = null;
    manifestUrl = '/csszyx-manifest.json';
    manifestHits.clear();
    manifestBytes = 0;
}
