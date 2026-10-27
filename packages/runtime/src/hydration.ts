/**
 * Hydration Guard and Abort Protocol.
 *
 * This module implements the hydration safety mechanism that ensures
 * SSR/CSR consistency. It detects mangle map mismatches and executes
 * the abort protocol when necessary to preserve SSR invariants.
 */

import { CsszyxError } from '@csszyx/compiler/errors';
import {
    CSR_RECOVERY_UNMARKED,
    CSR_RECOVERY_USED,
    HYDRATION_ABORTED,
    MANGLE_CENSUS_UNREADABLE,
    MANGLE_CHECKSUM_MISMATCH,
    MANGLE_MAP_UNAVAILABLE,
    MANGLE_MAP_UNREADABLE,
    szRender,
    szReport,
    WEB_CRYPTO_UNAVAILABLE,
} from '@csszyx/compiler/report';

import { createHydrationMangleMap } from './hydration-map.js';
import { digestMangleMap, webCryptoUnavailable } from './mangle-checksum.js';
import { getMangleRegistry } from './mangle-registry.js';
import { sortStrings } from './sort.js';
import type { RecoveryManifest } from './verify.js';
import { getRecoveryMode, hasRecoveryToken } from './verify.js';

/**
 * Recompute a mangle map's checksum the way the Rust core does, with Web
 * Crypto, so it works without the WASM core.
 *
 * @param map - the mangle map to checksum.
 * @returns the 16-char hex checksum, byte-for-byte what the Rust core derives
 *          from the same map, whatever characters the class names carry.
 * @throws {CsszyxError} `web-crypto-unavailable`, in an insecure context.
 */
export async function computeMangleChecksumAsync(map: MangleMap): Promise<string> {
    if (webCryptoUnavailable()) {
        const args = {};
        throw new CsszyxError({
            code: 'web-crypto-unavailable',
            args,
            message:
                process.env.NODE_ENV !== 'production'
                    ? szRender({ diagnostic: WEB_CRYPTO_UNAVAILABLE, args })
                    : `[csszyx] web-crypto-unavailable: ${JSON.stringify(args)} https://csszyx.com/e/web-crypto-unavailable`,
        });
    }
    return await digestMangleMap(map);
}

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

/** The `hydration-aborted` form of each error type. */
const HYDRATION_ABORTED_FORM = {
    checksum_mismatch: 'checksum-mismatch',
    map_missing: 'map-missing',
    invalid_token: 'invalid-token',
} as const satisfies Record<HydrationErrorType, string>;

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
 * The script element that carries the page's mangle census, if any.
 *
 * @returns The element, or null.
 */
function censusElement(): HTMLElement | null {
    return (
        document.getElementById('__CSSZYX_MANGLE_MAP__') ??
        document.getElementById('__SZ_MANGLE_MAP__')
    );
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

    const scriptElement = censusElement();

    if (!scriptElement) {
        return null;
    }

    try {
        const content = scriptElement.textContent || '';
        const parsed: unknown = JSON.parse(content);
        if (!isValidMangleMap(parsed)) {
            reportUnreadableMap({ form: 'schema' });
            return null;
        }
        return parsed;
    } catch (error) {
        reportUnreadableMap({ form: 'json', error: (error as SyntaxError).message });
        return null;
    }
}

/**
 * Say that the page's mangle map is ignored, in production too: the map is an
 * integrity input, and a page that drops it renders other than it was built.
 *
 * @param args - Why it does not read: its shape, or the parser's message.
 */
function reportUnreadableMap(args: NonNullable<(typeof MANGLE_MAP_UNREADABLE)['argsType']>): void {
    if (process.env.NODE_ENV !== 'production') {
        szReport({ diagnostic: MANGLE_MAP_UNREADABLE, args });
    } else {
        console.error(
            `[csszyx] mangle-map-unreadable: ${JSON.stringify(args)} https://csszyx.com/e/mangle-map-unreadable`,
        );
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
 * @internal Used by csszyx's own packages; not a stable API.
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
 * The map the checksum was computed over, from wherever this page carries it.
 *
 * The census in the document comes first: it is what a reader decodes the
 * page with, so it is what most needs checking. A build that ships no census
 * (`hydrationCensus: false`) still installs the same map from inside its
 * bundle, because the runtime needs it to rename classes. A build that
 * mangles nothing installs no registry, and its checksum is that of the empty
 * map, which is the map it has.
 *
 * @returns the map and whether it came from the page or stands in for none.
 */
function hydrationMapOfPage(): { map: MangleMap; found: boolean; unreadable?: true } {
    const census = loadMangleMapFromDOM();
    if (census) return { map: census, found: true };
    // A census the page carries but nothing can read was damaged on the way,
    // which is what the check exists to catch: never read past it.
    if (typeof document !== 'undefined' && censusElement()) {
        return { map: {}, found: false, unreadable: true };
    }
    const registry = getMangleRegistry();
    if (registry) {
        return {
            map: createHydrationMangleMap(registry.mangleMap, registry.varMangleMap),
            found: true,
        };
    }
    return { map: {}, found: false };
}

/**
 * Verify a mangle map's integrity by RECOMPUTING its checksum (via Web Crypto)
 * and comparing it to the expected value. Unlike the sync
 * {@link verifyMangleChecksum} (a plain attribute compare), this recomputes
 * from the map, so it detects a map that was altered without updating the
 * checksum.
 *
 * Without a `map` argument it reads the census in the document, or, on a
 * build that ships none, the map the bundle installed; a build that mangles
 * nothing is checked against the empty map. Each of those is a configuration,
 * so each verifies quietly. Every `false` prints why: the map does not match,
 * Web Crypto is unavailable, the page's census cannot be read, or the page
 * carries a checksum and no map.
 *
 * Still tamper-DETECTION, not authentication: the checksum is unsigned, so an
 * attacker who can rewrite the served HTML can recompute it after editing the
 * map. Use it to catch corruption / accidental drift, not as a trust boundary.
 *
 * @param expectedChecksum - the checksum to match (e.g. from the manifest or the
 *        `data-sz-checksum` attribute).
 * @param map - the mangle map; read from the page when omitted.
 * @returns a promise resolving true only when the checksum was recomputed and
 *          matches.
 */
export async function verifyMangleChecksumAsync(
    expectedChecksum: string,
    map?: MangleMap,
): Promise<boolean> {
    // Fail closed, and say so. Answering `false` alone would read as a tampered
    // map; the caller needs to know the check never ran. Warned in production
    // too: a caller believing integrity was verified when it was not is exactly
    // the state this function exists to prevent.
    if (webCryptoUnavailable()) {
        if (process.env.NODE_ENV !== 'production') {
            szReport({ diagnostic: WEB_CRYPTO_UNAVAILABLE, args: {} });
        } else {
            console.warn(
                `[csszyx] web-crypto-unavailable: ${JSON.stringify({})} https://csszyx.com/e/web-crypto-unavailable`,
            );
        }
        return false;
    }
    const source = map ? { map, found: true } : hydrationMapOfPage();
    if ('unreadable' in source) {
        if (process.env.NODE_ENV !== 'production') {
            szReport({ diagnostic: MANGLE_CENSUS_UNREADABLE, args: {} });
        } else {
            console.warn(
                `[csszyx] mangle-census-unreadable: ${JSON.stringify({})} https://csszyx.com/e/mangle-census-unreadable`,
            );
        }
        return false;
    }
    const computed = await digestMangleMap(source.map);
    if (computed === expectedChecksum) return true;
    if (source.found) {
        reportMangleChecksumMismatch(computed, expectedChecksum);
    } else {
        reportMangleMapUnavailable(expectedChecksum);
    }
    return false;
}

/**
 * Say that the map recomputes to a checksum other than the expected one.
 *
 * @param computed - The checksum recomputed from the map.
 * @param expected - The checksum it had to match.
 */
function reportMangleChecksumMismatch(computed: string, expected: string): void {
    const args = { computed, expected };
    if (process.env.NODE_ENV !== 'production') {
        szReport({ diagnostic: MANGLE_CHECKSUM_MISMATCH, args });
    } else {
        console.warn(
            `[csszyx] mangle-checksum-mismatch: ${JSON.stringify(args)} https://csszyx.com/e/mangle-checksum-mismatch`,
        );
    }
}

/**
 * Say that the page carries a checksum and no map to recompute it from.
 *
 * @param checksum - The checksum the page carries.
 */
function reportMangleMapUnavailable(checksum: string): void {
    const args = { checksum };
    if (process.env.NODE_ENV !== 'production') {
        szReport({ diagnostic: MANGLE_MAP_UNAVAILABLE, args });
    } else {
        console.warn(
            `[csszyx] mangle-map-unavailable: ${JSON.stringify(args)} https://csszyx.com/e/mangle-map-unavailable`,
        );
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

    // Step 3: Log audit message, with the element, which the console can
    // reveal. A type csszyx raises itself says what happened; the other two
    // only reach here from a caller, whose message the line carries.
    const args = {
        form: HYDRATION_ABORTED_FORM[error.type],
        tagName: element.localName,
        ...(error.type === 'checksum_mismatch' ? {} : { message: error.message }),
    };
    if (process.env.NODE_ENV !== 'production') {
        szReport({ diagnostic: HYDRATION_ABORTED, args, extra: [element] });
    } else {
        console.error(
            `[csszyx] hydration-aborted: ${JSON.stringify(args)} https://csszyx.com/e/hydration-aborted`,
            element,
        );
    }

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
        if (process.env.NODE_ENV !== 'production') {
            szReport({ diagnostic: CSR_RECOVERY_UNMARKED, args: {}, extra: [element] });
        } else {
            console.warn(
                `[csszyx] csr-recovery-unmarked: ${JSON.stringify({})} https://csszyx.com/e/csr-recovery-unmarked`,
                element,
            );
        }
        return false;
    }

    const mode = getRecoveryMode(element);

    // dev-only mode only works in development
    // Only a production build reaches this line, so it has only the compact
    // form: its sentence is on the code's page.
    if (mode === 'dev-only' && process.env.NODE_ENV === 'production') {
        console.warn(
            `[csszyx] csr-recovery-dev-only: ${JSON.stringify({ form: 'runtime' })} https://csszyx.com/e/csr-recovery-dev-only`,
            element,
        );
        return false;
    }

    if (process.env.NODE_ENV !== 'production') {
        szReport({ diagnostic: CSR_RECOVERY_USED, args: {}, extra: [element] });
    } else {
        console.warn(
            `[csszyx] csr-recovery-used: ${JSON.stringify({})} https://csszyx.com/e/csr-recovery-used`,
            element,
        );
    }

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
 * @internal Used by csszyx's own packages; not a stable API.
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
