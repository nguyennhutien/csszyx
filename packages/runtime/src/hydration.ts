/**
 * Hydration Guard and Abort Protocol.
 *
 * This module implements the hydration safety mechanism that ensures
 * SSR/CSR consistency. It detects mangle map mismatches and executes
 * the abort protocol when necessary to preserve SSR invariants.
 */

import type { RecoveryManifest } from './verify.js';
import { getRecoveryMode, hasRecoveryToken } from './verify.js';

/**
 * Window augmentation for csszyx global state.
 */
declare global {
    /**
     * Extended Window interface for csszyx runtime state.
     */
    interface Window {
        /** Flag to allow CSR recovery in development */
        __SZ_ALLOW_CSR_RECOVERY__?: boolean;
        /** Flag indicating if the app is currently hydrating */
        __SZ_HYDRATING__?: boolean;
        /** Next.js data (for framework detection) */
        __NEXT_DATA__?: unknown;
        /** Remix context (for framework detection) */
        __REMIX_CONTEXT__?: unknown;
    }
}

/**
 * Mangle map structure loaded from the DOM.
 */
export interface MangleMap {
    [originalClass: string]: string;
}

/**
 * Hydration error types.
 */
export type HydrationErrorType = 'checksum_mismatch' | 'map_missing' | 'invalid_token';

/**
 * Hydration error details.
 */
export interface HydrationError {
    type: HydrationErrorType;
    message: string;
    element?: HTMLElement;
    timestamp: number;
}

/**
 * Global hydration state.
 */
interface HydrationState {
    errors: HydrationError[];
    abortedSubtrees: Set<HTMLElement>;
    recoveryAllowed: boolean;
}

/**
 * Global state (internal).
 */
const state: HydrationState = {
    errors: [],
    abortedSubtrees: new Set(),
    recoveryAllowed: false,
};

/**
 * Enables CSR recovery mode (development only).
 *
 * Sets the global flag to allow client-side recovery when
 * hydration mismatches occur. Should only be used in development.
 *
 * @example
 * ```typescript
 * if (process.env.NODE_ENV === 'development') {
 *     enableCSRRecovery();
 * }
 * ```
 */
export function enableCSRRecovery(): void {
    state.recoveryAllowed = true;

    if (typeof window !== 'undefined') {
        window.__SZ_ALLOW_CSR_RECOVERY__ = true;
    }
}

/**
 * Disables CSR recovery mode.
 */
export function disableCSRRecovery(): void {
    state.recoveryAllowed = false;

    if (typeof window !== 'undefined') {
        window.__SZ_ALLOW_CSR_RECOVERY__ = false;
    }
}

/**
 * Checks if CSR recovery is allowed.
 *
 * @returns {boolean} True if recovery is allowed
 */
export function isCSRRecoveryAllowed(): boolean {
    return state.recoveryAllowed;
}

/**
 * Loads the mangle map from the DOM.
 *
 * Searches for the embedded mangle map script tag and parses it.
 *
 * @returns {MangleMap | null} The mangle map or null if not found
 *
 * @example
 * ```typescript
 * const mangleMap = loadMangleMapFromDOM();
 * if (mangleMap) {
 *     console.log('Mangle map loaded');
 * }
 * ```
 */
/** Upper bound on mangle-map entries — guards against a malformed/hostile map. */
const MAX_MANGLE_MAP_ENTRIES = 100_000;

/**
 * Validate a parsed mangle map before it is used to rewrite class names. The map
 * is read from the DOM (attacker-writable if the served HTML is compromised), so
 * it must be a plain object of string→string with no prototype-polluting keys.
 * A malformed map is rejected rather than applied.
 *
 * @param value - the `JSON.parse`d candidate.
 * @returns true when `value` is a safe `MangleMap`.
 */
export function isValidMangleMap(value: unknown): value is MangleMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_MANGLE_MAP_ENTRIES) {
        return false;
    }
    for (const [key, val] of entries) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return false;
        }
        if (typeof key !== 'string' || typeof val !== 'string') {
            return false;
        }
    }
    return true;
}

export function loadMangleMapFromDOM(): MangleMap | null {
    if (typeof document === 'undefined') {
        return null;
    }

    const scriptElement =
        document.getElementById('__CSSZYX_MANGLE_MAP__') ??
        document.getElementById('__SZ_MANGLE_MAP__');

    if (!scriptElement) {
        return null;
    }

    try {
        const content = scriptElement.textContent || '';
        const parsed: unknown = JSON.parse(content);
        if (!isValidMangleMap(parsed)) {
            console.error(
                '[csszyx] Mangle map failed schema validation (not a plain string→string map); ignoring it.',
            );
            return null;
        }
        return parsed;
    } catch (error) {
        console.error('Failed to parse mangle map:', error);
        return null;
    }
}

/**
 * Verifies mangle map checksum from HTML tag.
 *
 * Compares the checksum in the data-sz-checksum attribute with the
 * expected checksum to detect mangle map mismatches.
 *
 * @param {string} expectedChecksum - Expected checksum
 * @returns {boolean} True if checksums match
 *
 * @example
 * ```typescript
 * if (!verifyMangleChecksum(manifest.mangleChecksum)) {
 *     console.error('Checksum mismatch detected');
 * }
 * ```
 */
export function verifyMangleChecksum(expectedChecksum: string): boolean {
    if (typeof document === 'undefined') {
        return false;
    }

    const htmlElement = document.documentElement;
    const actualChecksum = htmlElement.getAttribute('data-sz-checksum');

    return actualChecksum === expectedChecksum;
}

/**
 * Recompute a mangle map's checksum the same way the Rust core does
 * (`compute_checksum_internal`): SHA-256 over the entries sorted by key and
 * formatted `orig:mangle`, joined by `|`, hex-encoded, first 16 chars (64 bits).
 *
 * Uses the Web Crypto API (`crypto.subtle`), so it works WITHOUT the WASM core —
 * unlike the WASM-only sync path. Async because `crypto.subtle.digest` is async.
 *
 * @param map - the mangle map to checksum.
 * @returns the 16-char hex checksum (matches the Rust output byte-for-byte for
 *          ASCII class names).
 */
export async function computeMangleChecksumAsync(map: MangleMap): Promise<string> {
    const canonical = Object.keys(map)
        .sort()
        .map(key => `${key}:${map[key]}`)
        .join('|');
    const bytes = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    let hex = '';
    for (const b of new Uint8Array(digest)) {
        hex += b.toString(16).padStart(2, '0');
    }
    return hex.slice(0, 16);
}

/**
 * Verify a mangle map's integrity by RECOMPUTING its checksum (via Web Crypto)
 * and comparing it to the expected value — real verification that works without
 * the WASM core. Unlike the sync {@link verifyMangleChecksum} (a plain attribute
 * compare), this recomputes from the map, so it detects a map that was altered
 * without updating the checksum.
 *
 * Still tamper-DETECTION, not authentication: the checksum is unsigned, so an
 * attacker who can rewrite the served HTML can recompute it after editing the
 * map. Use it to catch corruption / accidental drift, not as a trust boundary.
 *
 * @param expectedChecksum - the checksum to match (e.g. from the manifest or the
 *        `data-sz-checksum` attribute).
 * @param map - the mangle map; loaded (and schema-validated) from the DOM when omitted.
 * @returns a promise resolving true when the map is present and its recomputed
 *          checksum matches.
 */
export async function verifyMangleChecksumAsync(
    expectedChecksum: string,
    map?: MangleMap,
): Promise<boolean> {
    const target = map ?? loadMangleMapFromDOM();
    if (!target) {
        return false;
    }
    const actual = await computeMangleChecksumAsync(target);
    return actual === expectedChecksum;
}

/**
 * Verifies mangle map integrity using the Rust core checksum verifier.
 *
 * Loads the mangle map from the DOM, validates its shape, and (when the WASM
 * core is present) verifies its checksum via `verify_mangle_checksum()`.
 *
 * IMPORTANT — this is tamper-DETECTION, not authentication. The checksum is an
 * unsigned SHA-256 truncation: it catches accidental server/client drift, but an
 * attacker who can rewrite the served HTML can recompute it after editing the
 * map. Treat it as an integrity (corruption) check, not a trust boundary.
 *
 * When the WASM verifier is absent (the common no-core deployment), the checksum
 * cannot be recomputed in this sync path, so verification degrades to a
 * schema-validated load and emits a dev warning rather than failing closed
 * (failing closed here would break every app not shipping the WASM core).
 *
 * @returns {boolean} True if the map is well-formed and (if verifiable) matches.
 */
export function verifyMangleMapIntegrity(): boolean {
    if (typeof document === 'undefined') {
        return false;
    }

    // Get checksum from HTML
    const htmlElement = document.documentElement;
    const checksum = htmlElement.getAttribute('data-sz-checksum');

    if (!checksum) {
        console.warn('[csszyx] No checksum found in HTML');
        return false;
    }

    // Load mangle map from script tag
    const scriptElement = document.getElementById('__CSSZYX_MANGLE_MAP__');

    if (!scriptElement) {
        console.warn('[csszyx] Mangle map script not found');
        return false;
    }

    try {
        const parsed: unknown = JSON.parse(scriptElement.textContent || '{}');
        if (!isValidMangleMap(parsed)) {
            console.error(
                '[csszyx] Mangle map failed schema validation; treating integrity as invalid.',
            );
            return false;
        }
        const mangleMap = parsed;

        // Verify using Rust core if available
        if (typeof window !== 'undefined' && 'verify_mangle_checksum' in window) {
            // @ts-expect-error - Rust WASM function
            const isValid = window.verify_mangle_checksum(mangleMap, checksum);
            return isValid;
        }

        // No WASM verifier: the checksum can't be recomputed in this sync path.
        // The map is schema-valid; accept it but warn that integrity is unverified.
        if (process.env.NODE_ENV !== 'production') {
            console.warn(
                '[csszyx] WASM core not loaded — mangle map checksum is unverified ' +
                    '(schema-validated only). This is detection, not authentication.',
            );
        }
        return true;
    } catch (error) {
        console.error('[csszyx] Failed to verify mangle map:', error);
        return false;
    }
}

/**
 * Executes the hydration abort protocol for a subtree.
 *
 * Implements the 5-step abort protocol:
 * 1. Terminate hydration at subtree root
 * 2. Preserve static HTML/CSS from SSR
 * 3. Log audit message
 * 4. Inject abort attribute
 * 5. Block event handlers
 *
 * @param {HTMLElement} element - Root of the subtree to abort
 * @param {HydrationError} error - The hydration error that triggered abort
 *
 * @example
 * ```typescript
 * abortHydration(element, {
 *     type: 'checksum_mismatch',
 *     message: 'Mangle checksum mismatch',
 *     timestamp: Date.now()
 * });
 * ```
 */
export function abortHydration(element: HTMLElement, error: HydrationError): void {
    // Step 1: Mark subtree as aborted
    state.abortedSubtrees.add(element);

    // Step 2: Preserve static HTML (no re-render needed, just mark)
    // React/framework-specific implementation would go here

    // Step 3: Log audit message
    console.error(`[csszyx] Hydration aborted at ${element.tagName}:`, error.message);

    // Step 4: Inject abort attribute
    element.setAttribute('data-sz-hydration-aborted', error.timestamp.toString());
    element.setAttribute('data-sz-abort-reason', error.type);

    // Step 5: Block event handlers (framework-specific)
    // For now, add a marker that frameworks can check
    element.setAttribute('data-sz-interactive', 'false');

    // Store error
    state.errors.push({
        ...error,
        element,
    });
}

/**
 * Checks if a subtree has been aborted.
 *
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if hydration was aborted
 *
 * @example
 * ```typescript
 * if (isHydrationAborted(element)) {
 *     // Skip hydration for this subtree
 * }
 * ```
 */
export function isHydrationAborted(element: HTMLElement): boolean {
    return state.abortedSubtrees.has(element) || element.hasAttribute('data-sz-hydration-aborted');
}

/**
 * Guards hydration process by verifying mangle map integrity.
 *
 * Main entry point for hydration guarding. Checks the mangle map
 * checksum and executes the abort protocol if there's a mismatch.
 *
 * @param {RecoveryManifest} manifest - Recovery manifest
 * @returns {boolean} True if hydration can proceed safely
 *
 * @example
 * ```typescript
 * const manifest = loadManifestFromDOM();
 * if (manifest && !guardHydration(manifest)) {
 *     console.error('Hydration guard failed');
 * }
 * ```
 */
export function guardHydration(manifest: RecoveryManifest): boolean {
    if (typeof document === 'undefined') {
        return true;
    }

    // Verify mangle map checksum. Recovery manifest `checksum` protects the
    // token set; `mangleChecksum` is the value that must match HTML.
    if (!verifyMangleChecksum(manifest.mangleChecksum)) {
        const error: HydrationError = {
            type: 'checksum_mismatch',
            message: 'Mangle map checksum mismatch detected',
            timestamp: Date.now(),
        };

        // Abort hydration at document root
        abortHydration(document.documentElement, error);

        return false;
    }

    return true;
}

/**
 * Attempts client-side recovery for an aborted subtree.
 *
 * Only allowed in development mode when CSR recovery is enabled.
 * Logs a warning to remind developer to fix the root cause.
 *
 * @param {HTMLElement} element - Element to recover
 * @returns {boolean} True if recovery was attempted
 *
 * @example
 * ```typescript
 * if (isCSRRecoveryAllowed() && isHydrationAborted(element)) {
 *     attemptCSRRecovery(element);
 * }
 * ```
 */
export function attemptCSRRecovery(element: HTMLElement): boolean {
    if (!state.recoveryAllowed) {
        return false;
    }

    // Check if element has explicit recovery permission
    if (!hasRecoveryToken(element)) {
        console.warn('[csszyx] CSR recovery requires explicit szRecover directive');
        return false;
    }

    const mode = getRecoveryMode(element);

    // dev-only mode only works in development
    if (mode === 'dev-only' && process.env.NODE_ENV === 'production') {
        console.warn('[csszyx] szRecover="dev-only" is disabled in production');
        return false;
    }

    console.warn(
        '[csszyx] Hydration mismatch recovered via CSR. Fix root cause before production.',
    );

    // Remove abort markers
    element.removeAttribute('data-sz-hydration-aborted');
    element.removeAttribute('data-sz-abort-reason');
    element.removeAttribute('data-sz-interactive');

    state.abortedSubtrees.delete(element);

    return true;
}

/**
 * Gets all hydration errors.
 *
 * @returns {HydrationError[]} Array of errors
 *
 * @example
 * ```typescript
 * const errors = getHydrationErrors();
 * console.log(`Found ${errors.length} hydration errors`);
 * ```
 */
export function getHydrationErrors(): HydrationError[] {
    return [...state.errors];
}

/**
 * Clears hydration errors (for testing).
 */
export function clearHydrationErrors(): void {
    state.errors = [];
    state.abortedSubtrees.clear();
}

/**
 * Gets the count of aborted subtrees.
 *
 * @returns {number} Number of aborted subtrees
 */
export function getAbortedSubtreeCount(): number {
    return state.abortedSubtrees.size;
}

// ============================================================================
// SSR Context & Hydration Safety
// ============================================================================

/**
 * SSR context structure embedded in the HTML.
 */
export interface SSRContext {
    /**
     * Build ID for cache invalidation.
     */
    buildId: string;

    /**
     * Checksum of the mangle map.
     */
    checksum: string;

    /**
     * Timestamp when the page was rendered.
     */
    timestamp: number;

    /**
     * Whether recovery tokens are present.
     */
    hasRecoveryTokens: boolean;
}

/**
 * Checks if the current environment is SSR (server-side).
 *
 * @returns {boolean} True if running on server
 *
 * @example
 * ```typescript
 * if (isSSREnvironment()) {
 *     // Server-side logic
 * } else {
 *     // Client-side logic
 * }
 * ```
 */
export function isSSREnvironment(): boolean {
    return typeof window === 'undefined';
}

/**
 * Checks if the application is currently hydrating.
 *
 * Reads the hydration state from the window object set by the framework.
 *
 * @returns {boolean} True if hydrating
 *
 * @example
 * ```typescript
 * if (isHydrating()) {
 *     // Use SSR-generated classes
 * } else {
 *     // Safe to use dynamic classes
 * }
 * ```
 */
export function isHydrating(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    // Check for csszyx hydration flag
    if (window.__SZ_HYDRATING__ !== undefined) {
        return window.__SZ_HYDRATING__;
    }

    // Check for React hydration (common pattern)
    if (window.__NEXT_DATA__ || window.__REMIX_CONTEXT__) {
        // These frameworks set hydration state
        return document.documentElement.hasAttribute('data-sz-checksum');
    }

    return false;
}

/**
 * Gets the SSR context from the DOM.
 *
 * Reads the context embedded by the server during SSR to ensure
 * consistent class generation between server and client.
 *
 * @returns {SSRContext | null} The SSR context or null if not found
 *
 * @example
 * ```typescript
 * const context = getSSRContext();
 * if (context) {
 *     console.log('Build ID:', context.buildId);
 *     console.log('Checksum:', context.checksum);
 * }
 * ```
 */
export function getSSRContext(): SSRContext | null {
    if (typeof document === 'undefined') {
        return null;
    }

    const htmlElement = document.documentElement;
    const checksum = htmlElement.getAttribute('data-sz-checksum');
    const buildId = htmlElement.getAttribute('data-sz-build-id');

    if (!checksum || !buildId) {
        return null;
    }

    const timestampAttr = htmlElement.getAttribute('data-sz-timestamp');
    const timestamp = timestampAttr ? parseInt(timestampAttr, 10) : 0;

    const hasRecoveryTokens = document.querySelector('[data-sz-recovery-token]') !== null;

    return {
        buildId,
        checksum,
        timestamp,
        hasRecoveryTokens,
    };
}

/**
 * Validates that client-side class generation matches SSR.
 *
 * Call this during hydration to ensure consistency between server
 * and client rendered classes.
 *
 * @param {string} className - The className generated on the client
 * @param {string} expectedClassName - The className from SSR
 * @returns {boolean} True if classes match
 *
 * @example
 * ```typescript
 * const serverClass = element.className;
 * const clientClass = _sz({ p: 4, bg: 'red-500' });
 *
 * if (!validateHydrationClass(clientClass, serverClass)) {
 *     console.warn('Hydration mismatch detected');
 * }
 * ```
 */
export function validateHydrationClass(className: string, expectedClassName: string): boolean {
    // Normalize both class strings for comparison
    const normalize = (s: string): string => s.split(/\s+/).filter(Boolean).sort().join(' ');

    return normalize(className) === normalize(expectedClassName);
}

/**
 * Marks the start of hydration.
 *
 * Call this when your framework begins hydration to enable
 * hydration-safe mode in the runtime.
 *
 * @example
 * ```typescript
 * // In your app entry point
 * startHydration();
 * hydrateRoot(document.getElementById('root'), <App />);
 * ```
 */
export function startHydration(): void {
    if (typeof window !== 'undefined') {
        window.__SZ_HYDRATING__ = true;
    }
}

/**
 * Marks the end of hydration.
 *
 * Call this when hydration is complete to allow dynamic class
 * generation without SSR constraints.
 *
 * @example
 * ```typescript
 * // After hydration completes
 * endHydration();
 * ```
 */
export function endHydration(): void {
    if (typeof window !== 'undefined') {
        window.__SZ_HYDRATING__ = false;
    }
}
