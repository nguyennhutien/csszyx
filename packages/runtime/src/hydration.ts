/**
 * Hydration Guard and Abort Protocol.
 *
 * This module implements the hydration safety mechanism that ensures
 * SSR/CSR consistency. It detects mangle map mismatches and executes
 * the abort protocol when necessary to preserve SSR invariants.
 */

import { getMangleRegistry } from './mangle-registry.js';
import { sortStrings } from './sort.js';
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
 * Cap on retained hydration errors. Each error can hold an element reference,
 * and the state is module-level — without a bound, an SPA hitting recurring
 * aborts across navigations would retain every detached subtree it ever
 * aborted. Oldest errors are evicted first; recent ones matter for debugging.
 */
const MAX_HYDRATION_ERRORS = 100;

/**
 * Global hydration state.
 *
 * `abortedSubtrees` is a WeakSet so an aborted subtree that leaves the DOM can
 * be garbage-collected — membership only needs to answer `isHydrationAborted`
 * for elements someone still holds. The count and clear semantics that a
 * WeakSet cannot provide live in `abortedSubtreeCount` (counts abort marks
 * minus recoveries this session, independent of element lifetime) and in
 * replacing the WeakSet wholesale on clear. The DOM attribute written by
 * `abortHydration` remains the durable marker.
 */
interface HydrationState {
    errors: HydrationError[];
    abortedSubtrees: WeakSet<HTMLElement>;
    abortedSubtreeCount: number;
    recoveryAllowed: boolean;
}

/**
 * Global state (internal).
 */
const state: HydrationState = {
    errors: [],
    abortedSubtrees: new WeakSet(),
    abortedSubtreeCount: 0,
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

/**
 * Load and validate the mangle map embedded in the DOM by the SSR pipeline.
 *
 * @returns the validated mangle map, or `null` if absent or invalid.
 */
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
 * Read the mangle checksum the build stamped on an element.
 *
 * The build writes `data-sz-checksum`, or `data-sz-cs` when `production.minify`
 * is on — which it is by default. Readers therefore have to accept both, and
 * they all come through here so the two names cannot drift apart again.
 *
 * @param element - the element the build stamped, normally `<html>`.
 * @returns the checksum, or undefined when the element carries neither name.
 */
export function readChecksumAttribute(element: HTMLElement): string | undefined {
    return element.dataset.szChecksum ?? element.dataset.szCs;
}

/**
 * Does the bundle that is running match the document it is running in?
 *
 * This is the one comparison the hydration checksum exists to make, and the
 * only one that spans the two artefacts a deploy can separate. Every other
 * verifier here takes both of its values out of the same HTML — the attribute
 * against the census beside it, or against a manifest tag beside that — so it
 * answers "consistent" for a document that is internally consistent and stale.
 *
 * The build stamps one checksum into both halves: the attribute on `<html>`,
 * and the registry the generated module installs from inside the JS bundle.
 * When a page serves yesterday's HTML to today's bundle, those two disagree,
 * and the classes in the markup no longer mean what the bundle's map says they
 * mean — the failure renders as an unstyled page with nothing in the console.
 *
 * Absence is not disagreement. A build without mangling installs no registry,
 * and a document that carries no checksum was not built by a lane that writes
 * one; neither is a mismatch, and neither should abort a hydration.
 *
 * @returns `false` only when both values are present and differ.
 */
export function verifyBundleMatchesDocument(): boolean {
    if (typeof document === 'undefined') return true;
    const registry = getMangleRegistry();
    const shipped = registry?.checksum;
    if (!shipped) return true;
    const rendered = readChecksumAttribute(document.documentElement);
    if (rendered === undefined) return true;
    return rendered === shipped;
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
    const actualChecksum = readChecksumAttribute(htmlElement);

    return actualChecksum === expectedChecksum;
}

/**
 * Why Web Crypto cannot be used here, or null when it can.
 *
 * `crypto.subtle` exists only in a secure context, so a page served over plain
 * HTTP from anything but localhost does not have it. Both the compute and the
 * verify path need this answer and both need to say the same thing about it,
 * so the sentence lives here once.
 *
 * @returns the reason, or null when Web Crypto is available.
 */
function webCryptoUnavailable(): string | null {
    if (typeof crypto === 'undefined' || crypto.subtle === undefined) {
        return (
            '[csszyx] Web Crypto is unavailable, so the mangle checksum cannot be recomputed. ' +
            'crypto.subtle exists only in a secure context: serve the page over HTTPS, or ' +
            'from localhost. Nothing was verified.'
        );
    }
    return null;
}

/**
 * Order two byte sequences the way Rust orders the strings they encode.
 *
 * @param a - left operand.
 * @param b - right operand.
 * @returns negative, zero or positive, for `Array.prototype.sort`.
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
        const left = a[i] as number;
        const right = b[i] as number;
        if (left !== right) return left - right;
    }
    return a.length - b.length;
}

/**
 * Recompute a mangle map's checksum the same way the Rust core does
 * (`compute_checksum_internal`): SHA-256 over the entries sorted by key and
 * formatted `<origLen>:<orig>:<mangleLen>:<mangle>`, joined by `|`, hex-encoded,
 * first 16 chars (64 bits). The lengths count UTF-16 code units.
 *
 * Uses the Web Crypto API (`crypto.subtle`), so it works WITHOUT the WASM core —
 * unlike the WASM-only sync path. Async because `crypto.subtle.digest` is async.
 *
 * @param map - the mangle map to checksum.
 * @returns the 16-char hex checksum, byte-for-byte what the Rust core derives
 *          from the same map, whatever characters the class names carry.
 * @throws when Web Crypto is unavailable, which means an insecure context.
 */
export async function computeMangleChecksumAsync(map: MangleMap): Promise<string> {
    const unavailable = webCryptoUnavailable();
    if (unavailable !== null) {
        throw new Error(unavailable);
    }
    // Sort by the bytes that get hashed, which is what the Rust core compares.
    // Comparing the strings instead is a tenth of a millisecond cheaper on a
    // five-hundred-name map and wrong: JavaScript would order the text it holds
    // while the core orders the text it received, and an unpaired surrogate
    // survives the first and not the second. Encoding once per name settles it
    // without anyone having to reason about surrogates.
    //
    // The shape carries a length per field. See the core's
    // compute_checksum_internal: a name holding the separator — every variant
    // class holds a colon — would otherwise let two different maps render the
    // same text and share a checksum.
    const encoder = new TextEncoder();
    const canonical = Object.keys(map)
        .map(key => ({ key, bytes: encoder.encode(key) }))
        .sort((a, b) => compareBytes(a.bytes, b.bytes))
        .map(({ key }) => {
            const value = map[key] as string;
            return `${key.length}:${key}:${value.length}:${value}`;
        })
        .join('|');
    const bytes = encoder.encode(canonical);
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
    // Fail closed, and say so. Answering `false` alone would read as a tampered
    // map; the caller needs to know the check never ran. Warned in production
    // too: a caller believing integrity was verified when it was not is exactly
    // the state this function exists to prevent.
    const unavailable = webCryptoUnavailable();
    if (unavailable !== null) {
        console.warn(unavailable);
        return false;
    }
    return (await computeMangleChecksumAsync(target)) === expectedChecksum;
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
    const checksum = readChecksumAttribute(htmlElement);

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
    // Step 1: Mark subtree as aborted (idempotent — a re-abort of the same
    // element must not inflate the count).
    if (!state.abortedSubtrees.has(element)) {
        state.abortedSubtrees.add(element);
        state.abortedSubtreeCount++;
    }

    // Step 2: Preserve static HTML (no re-render needed, just mark)
    // React/framework-specific implementation would go here

    // Step 3: Log audit message
    console.error(`[csszyx] Hydration aborted at ${element.tagName}:`, error.message);

    // Step 4: Inject abort attribute
    element.dataset.szHydrationAborted = error.timestamp.toString();
    element.dataset.szAbortReason = error.type;

    // Step 5: Block event handlers (framework-specific)
    // For now, add a marker that frameworks can check
    element.dataset.szInteractive = 'false';

    // Store error, bounded — evict the oldest so the retained element
    // references cannot grow past the cap.
    state.errors.push({
        ...error,
        element,
    });
    if (state.errors.length > MAX_HYDRATION_ERRORS) {
        state.errors.shift();
    }
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
    return state.abortedSubtrees.has(element) || element.dataset.szHydrationAborted !== undefined;
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

    // Two comparisons, and only the second spans the deploy. The manifest's
    // `mangleChecksum` is read from a tag in this document, so matching it
    // against the attribute proves the document agrees with itself — worth
    // keeping, because a partial cache write breaks exactly that. What it
    // cannot see is a stale document under a fresh bundle, which is the case
    // this guard was written for: for that, the bundle has to be asked.
    if (!verifyMangleChecksum(manifest.mangleChecksum) || !verifyBundleMatchesDocument()) {
        const error: HydrationError = {
            type: 'checksum_mismatch',
            message:
                'Mangle map checksum mismatch: the HTML, the bundle and the manifest do not all come from one build',
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
    delete element.dataset.szHydrationAborted;
    delete element.dataset.szAbortReason;
    delete element.dataset.szInteractive;

    if (state.abortedSubtrees.delete(element)) {
        state.abortedSubtreeCount--;
    }

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
    state.abortedSubtrees = new WeakSet();
    state.abortedSubtreeCount = 0;
}

/**
 * Gets the count of aborted subtrees.
 *
 * Counts abort marks minus recoveries this session. Aborted elements that were
 * garbage-collected after leaving the DOM stay counted — the number reports
 * how many aborts happened, not how many aborted elements are still alive.
 *
 * @returns {number} Number of aborted subtrees
 */
export function getAbortedSubtreeCount(): number {
    return state.abortedSubtreeCount;
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
        return readChecksumAttribute(document.documentElement) !== undefined;
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
    const checksum = readChecksumAttribute(htmlElement);
    const buildId = htmlElement.dataset.szBuildId;

    if (!checksum || !buildId) {
        return null;
    }

    const timestampAttr = htmlElement.dataset.szTimestamp;
    const timestamp = timestampAttr ? Number.parseInt(timestampAttr, 10) : 0;

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
    const normalize = (s: string): string => sortStrings(s.split(/\s+/).filter(Boolean)).join(' ');

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
