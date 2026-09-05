/**
 * @csszyx/runtime - Runtime package for csszyx.
 *
 * This package provides runtime functionality for csszyx, including:
 * - Zero-allocation className concatenation helpers
 * - Recovery token verification
 * - Hydration guard and abort protocol
 *
 * @module @csszyx/runtime
 */

// Internal imports for use in initRuntime
import { version as packageVersion } from '../package.json';
import { enableCSRRecovery as _enableCSRRecovery } from './hydration.js';

// Export SzInput type from concatenate
export type { SzInput } from './concatenate.js';
// Export concatenation helpers
export { _sz, _sz2, _sz3, _szMerge, _szPart, szr } from './concatenate.js';
// Export hydration functions
export {
    abortHydration,
    attemptCSRRecovery,
    clearHydrationErrors,
    computeMangleChecksumAsync,
    disableCSRRecovery,
    enableCSRRecovery,
    endHydration,
    getAbortedSubtreeCount,
    getHydrationErrors,
    getSSRContext,
    guardHydration,
    type HydrationError,
    type HydrationErrorType,
    isCSRRecoveryAllowed,
    isHydrating,
    isHydrationAborted,
    isSSREnvironment,
    isValidMangleMap,
    loadMangleMapFromDOM,
    type MangleMap,
    readChecksumAttribute,
    type SSRContext,
    startHydration,
    validateHydrationClass,
    verifyBundleMatchesDocument,
    verifyMangleChecksum,
    verifyMangleChecksumAsync,
    verifyMangleMapIntegrity,
} from './hydration.js';
// Re-export lite helpers so consumers can import everything from @csszyx/runtime
export { __szBoolClass, __szColorVar, __szSpacingVar, __szUnitVar } from './lite.js';
// Runtime mangle registry — installed by the bundled registration module
export {
    clearMangleRegistry,
    getMangleRegistry,
    installMangleRuntime,
    type MangleRegistry,
    type MangleRegistryInput,
    type MangleVarValue,
} from './mangle-registry.js';
// Mangle-aware className merge (last-wins override) for layered components
export { _szcn, szcn, szDecode } from './merge-classes.js';

export {
    clearSzcnGroups,
    getSzcnGroups,
    registerSzcnGroups,
    type SzcnThemeGroups,
    setSzcnGroups,
} from './merge-groups.js';
// Box-model class routing + category-aware toolkit
export {
    type BoxRole,
    type BoxSelector,
    type Classification,
    classify,
    classifySzKey,
    has,
    hasSz,
    // The token scanner the toolkit classifies with. Public so a component
    // asking "is this a base-breakpoint token?" does not copy the
    // bracket-depth walk — copies cut `[&:hover]:w-4` at the inner colon.
    normalizeBase,
    omit,
    omitSz,
    pick,
    pickSz,
    type SplitBoxOptions,
    type SplitBoxResult,
    type SplitBoxSzOptions,
    type SplitBoxSzResult,
    splitBox,
    splitBoxSz,
    stripVariant,
} from './split-box.js';
// Strip the sz prop before forwarding props to a host element
export { stripSzProps } from './strip-sz-props.js';
// Runtime picker for build-precompiled szv tables (string-only)
export {
    __szvPick,
    __szvPick1,
    type SzvCompiledTable,
    type SzvPickSelection,
} from './szv-pick.js';
// Export variant authoring helper
export { szv } from './variants.js';
// Export verification functions
export {
    getRecoveryMode,
    hasRecoveryToken,
    isValidManifest,
    loadManifestFromDOM,
    type RecoveryManifest,
    type RecoveryMode,
    type TokenData,
    type VerificationResult,
    verifyAllTokens,
    verifyRecoveryToken,
} from './verify.js';

/**
 * Runtime version.
 */
export const VERSION: string = packageVersion;

/**
 * Runtime configuration options.
 */
export interface RuntimeConfig {
    /**
     * Enable development mode features
     */
    development?: boolean;

    /**
     * Allow CSR recovery in development
     */
    allowCSRRecovery?: boolean;

    /**
     * Enable strict hydration checks
     */
    strictHydration?: boolean;

    /**
     * Enable debug logging
     */
    debug?: boolean;
}

/**
 * Default runtime configuration.
 */
export const DEFAULT_RUNTIME_CONFIG: Required<RuntimeConfig> = {
    development: false,
    allowCSRRecovery: false,
    strictHydration: true,
    debug: false,
};

/**
 * Global runtime state.
 */
interface RuntimeState {
    config: Required<RuntimeConfig>;
    initialized: boolean;
}

/**
 * Internal runtime state.
 */
const runtimeState: RuntimeState = {
    config: { ...DEFAULT_RUNTIME_CONFIG },
    initialized: false,
};

/**
 * Initializes the csszyx runtime.
 *
 * Should be called once at application startup to configure the runtime
 * behavior and set up hydration guards.
 *
 * @param {Partial<RuntimeConfig>} config - Runtime configuration
 *
 * @example
 * ```typescript
 * // In your app entry point
 * initRuntime({
 *     development: process.env.NODE_ENV === 'development',
 *     allowCSRRecovery: true,
 *     debug: true
 * });
 * ```
 */
export function initRuntime(config: Partial<RuntimeConfig> = {}): void {
    if (runtimeState.initialized) {
        if (runtimeState.config.debug) {
            console.warn('[csszyx] Runtime already initialized');
        }
        return;
    }

    // Merge config
    runtimeState.config = {
        ...DEFAULT_RUNTIME_CONFIG,
        ...config,
    };

    // Set up CSR recovery if allowed
    if (runtimeState.config.allowCSRRecovery) {
        _enableCSRRecovery();
    }

    if (runtimeState.config.debug) {
        console.log('[csszyx] Runtime initialized', runtimeState.config);
    }

    runtimeState.initialized = true;
}

/**
 * Gets the current runtime configuration.
 *
 * @returns {Required<RuntimeConfig>} Current runtime config
 *
 * @example
 * ```typescript
 * const config = getRuntimeConfig();
 * console.log('Debug mode:', config.debug);
 * ```
 */
export function getRuntimeConfig(): Required<RuntimeConfig> {
    return { ...runtimeState.config };
}

/**
 * Checks if the runtime has been initialized.
 *
 * @returns {boolean} True if initialized
 */
export function isRuntimeInitialized(): boolean {
    return runtimeState.initialized;
}

/**
 * Resets the runtime state (for testing).
 */
export function resetRuntime(): void {
    runtimeState.config = { ...DEFAULT_RUNTIME_CONFIG };
    runtimeState.initialized = false;
}
