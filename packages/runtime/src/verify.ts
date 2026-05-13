/**
 * Recovery Token Verification - Runtime validation of recovery tokens.
 *
 * This module provides runtime verification of recovery tokens against
 * the recovery manifest embedded in the build output. It ensures that
 * szRecover directives are legitimate and haven't been tampered with.
 */

/**
 * Recovery mode types.
 */
export type RecoveryMode = 'csr' | 'dev-only';

/**
 * Token data from the manifest.
 */
export interface TokenData {
  mode: RecoveryMode;
  component: string;
  path: string;
}

/**
 * Recovery manifest structure.
 */
export interface RecoveryManifest {
  buildId: string;
  checksum: string;
  mangleChecksum: string;
  tokens: Record<string, TokenData>;
}

/**
 * Token verification result.
 */
export interface VerificationResult {
  /**
   * Whether the token is valid
   */
  valid: boolean;

  /**
   * Token data if valid
   */
  tokenData?: TokenData;

  /**
   * Error message if invalid
   */
  error?: string;
}

/**
 * Verifies a recovery token against the manifest.
 *
 * Checks that the token exists in the manifest and returns its metadata.
 * This is used at runtime to validate szRecover directives.
 *
 * @param {HTMLElement} element - The DOM element with the recovery token
 * @param {RecoveryManifest} manifest - The recovery manifest
 * @returns {VerificationResult} Verification result
 *
 * @example
 * ```typescript
 * const element = document.querySelector('[data-sz-recovery-token]');
 * const result = verifyRecoveryToken(element, manifest);
 *
 * if (result.valid) {
 *     console.log('Token verified:', result.tokenData);
 * } else {
 *     console.error('Invalid token:', result.error);
 * }
 * ```
 */
export function verifyRecoveryToken(
    element: HTMLElement,
    manifest: RecoveryManifest,
): VerificationResult {
    // Get token from element
    const token = element.getAttribute('data-sz-recovery-token');

    if (!token) {
        return {
            valid: false,
            error: 'No recovery token found on element',
        };
    }

    // Check if token exists in manifest
    const tokenData = manifest.tokens[token];

    if (!tokenData) {
        return {
            valid: false,
            error: `Token not found in manifest: ${token}`,
        };
    }

    // Verify szRecover attribute matches token mode
    const szRecover = element.getAttribute('szRecover');

    if (szRecover !== tokenData.mode) {
        return {
            valid: false,
            error: `szRecover attribute (${szRecover}) does not match token mode (${tokenData.mode})`,
        };
    }

    return {
        valid: true,
        tokenData,
    };
}

/**
 * Loads the recovery manifest from the DOM.
 *
 * Searches for the embedded manifest script tag and parses it.
 *
 * @returns {RecoveryManifest | null} The manifest or null if not found
 *
 * @example
 * ```typescript
 * const manifest = loadManifestFromDOM();
 * if (manifest) {
 *     console.log('Manifest loaded:', manifest.buildId);
 * }
 * ```
 */
export function loadManifestFromDOM(): RecoveryManifest | null {
    if (typeof document === 'undefined') {
        return null;
    }

    const scriptElement = document.getElementById('__SZ_RECOVERY_MANIFEST__');

    if (!scriptElement) {
        return null;
    }

    try {
        const content = scriptElement.textContent || '';
        return JSON.parse(content) as RecoveryManifest;
    } catch (error) {
        console.error('Failed to parse recovery manifest:', error);
        return null;
    }
}

/**
 * Validates manifest structure.
 *
 * @param {unknown} manifest - Manifest to validate
 * @returns {boolean} True if valid
 */
export function isValidManifest(
    manifest: unknown,
): manifest is RecoveryManifest {
    if (!manifest || typeof manifest !== 'object') {
        return false;
    }

    const m = manifest as Record<string, unknown>;

    return (
        typeof m.buildId === 'string' &&
        typeof m.checksum === 'string' &&
        typeof m.mangleChecksum === 'string' &&
        typeof m.tokens === 'object' &&
        m.tokens !== null
    );
}

/**
 * Verifies all elements with recovery tokens in a subtree.
 *
 * Scans the given root element and all its descendants for recovery tokens
 * and verifies them against the manifest.
 *
 * @param {HTMLElement} root - Root element to scan
 * @param {RecoveryManifest} manifest - Recovery manifest
 * @returns {VerificationResult[]} Array of verification results
 *
 * @example
 * ```typescript
 * const results = verifyAllTokens(document.body, manifest);
 * const invalid = results.filter(r => !r.valid);
 * if (invalid.length > 0) {
 *     console.error('Found invalid tokens:', invalid);
 * }
 * ```
 */
export function verifyAllTokens(
    root: HTMLElement,
    manifest: RecoveryManifest,
): VerificationResult[] {
    const elements = root.querySelectorAll('[data-sz-recovery-token]');
    const results: VerificationResult[] = [];

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLElement;
        const result = verifyRecoveryToken(element, manifest);
        results.push(result);
    }

    return results;
}

/**
 * Checks if an element has a valid recovery token.
 *
 * Quick check to see if an element has a recovery token without
 * full verification.
 *
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if element has recovery token
 *
 * @example
 * ```typescript
 * if (hasRecoveryToken(element)) {
 *     // Element has szRecover directive
 * }
 * ```
 */
export function hasRecoveryToken(element: HTMLElement): boolean {
    return element.hasAttribute('data-sz-recovery-token');
}

/**
 * Gets the recovery mode from an element.
 *
 * @param {HTMLElement} element - Element with recovery token
 * @returns {RecoveryMode | null} The recovery mode or null
 *
 * @example
 * ```typescript
 * const mode = getRecoveryMode(element);
 * if (mode === 'csr') {
 *     // Allow client-side recovery
 * }
 * ```
 */
export function getRecoveryMode(element: HTMLElement): RecoveryMode | null {
    const szRecover = element.getAttribute('szRecover');

    if (szRecover === 'csr' || szRecover === 'dev-only') {
        return szRecover;
    }

    return null;
}
