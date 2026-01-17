/**
 * Runtime types for csszyx.
 *
 * This module defines types used at runtime for hydration guards,
 * recovery tokens, and mangle maps.
 */

/**
 * Recovery mode types.
 */
export type RecoveryMode = 'csr' | 'dev-only';

/**
 * Token data stored in the recovery manifest.
 */
export interface TokenData {
  /**
   * Recovery mode ('csr' or 'dev-only')
   */
  mode: RecoveryMode;

  /**
   * Component name where the token was generated
   */
  component: string;

  /**
   * File path relative to project root
   */
  path: string;
}

/**
 * Recovery manifest structure.
 *
 * Embedded in build output as JSON in a script tag with id "__SZ_RECOVERY_MANIFEST__".
 */
export interface RecoveryManifest {
  /**
   * Build ID (git hash or timestamp)
   */
  buildId: string;

  /**
   * SHA-256 checksum of the tokens object for integrity verification
   */
  checksum: string;

  /**
   * Map of recovery token → token data
   */
  tokens: Record<string, TokenData>;
}

/**
 * Mangle map structure.
 *
 * Maps original Tailwind class names to their minified equivalents.
 * Embedded in build output as JSON in a script tag with id "__SZ_MANGLE_MAP__".
 */
export interface MangleMap {
  /**
   * Map of original class name → mangled class name
   */
  [originalClass: string]: string;
}

/**
 * Mangle map metadata.
 */
export interface MangleMapMetadata {
  /**
   * Build ID
   */
  buildId: string;

  /**
   * Total number of classes in the map
   */
  classCount: number;

  /**
   * SHA-256 checksum of the map for validation
   */
  checksum: string;

  /**
   * Timestamp when the map was generated
   */
  timestamp: number;
}

/**
 * Hydration error types.
 */
export type HydrationErrorType =
  | 'checksum_mismatch'
  | 'map_missing'
  | 'invalid_token'
  | 'abort_failed';

/**
 * Hydration error details.
 */
export interface HydrationError {
  /**
   * Error type
   */
  type: HydrationErrorType;

  /**
   * Error message
   */
  message: string;

  /**
   * Element where the error occurred (optional)
   */
  element?: HTMLElement;

  /**
   * Timestamp when error occurred
   */
  timestamp: number;

  /**
   * Stack trace (optional)
   */
  stack?: string;
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
 * Runtime state interface.
 */
export interface RuntimeState {
  /**
   * Whether the runtime has been initialized
   */
  initialized: boolean;

  /**
   * Current environment
   */
  environment: 'development' | 'production' | 'test';

  /**
   * Whether CSR recovery is allowed
   */
  csrRecoveryAllowed: boolean;

  /**
   * Loaded recovery manifest
   */
  manifest?: RecoveryManifest;

  /**
   * Loaded mangle map
   */
  mangleMap?: MangleMap;

  /**
   * Recorded hydration errors
   */
  errors: HydrationError[];

  /**
   * Count of aborted subtrees
   */
  abortedCount: number;
}

/**
 * JSX sz prop object type.
 */
export interface SzProp {
  [key: string]: string | number | boolean | SzProp;
}

/**
 * Component props with sz attribute.
 */
export interface ComponentPropsWithSz {
  /**
   * csszyx object syntax for Tailwind classes
   */
  sz?: SzProp | string;

  /**
   * Recovery mode (optional)
   */
  szRecover?: RecoveryMode;

  /**
   * Standard className prop (merged with sz)
   */
  className?: string;
}

/**
 * Audit log entry.
 */
export interface AuditLogEntry {
  /**
   * Log level
   */
  level: 'info' | 'warn' | 'error';

  /**
   * Log message
   */
  message: string;

  /**
   * Timestamp
   */
  timestamp: number;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Performance metrics.
 */
export interface PerformanceMetrics {
  /**
   * Time taken for hydration guard (ms)
   */
  hydrationGuardTime?: number;

  /**
   * Time taken for token verification (ms)
   */
  tokenVerificationTime?: number;

  /**
   * Total number of tokens verified
   */
  tokensVerified?: number;

  /**
   * Number of hydration errors
   */
  hydrationErrors?: number;

  /**
   * Memory usage (bytes)
   */
  memoryUsage?: number;
}

/**
 * Global window interface extensions for csszyx.
 */
export interface CsszyxWindow extends Window {
  /**
   * Allow CSR recovery flag (development only)
   */
  __SZ_ALLOW_CSR_RECOVERY__?: boolean;

  /**
   * Runtime state
   */
  __SZ_RUNTIME_STATE__?: RuntimeState;

  /**
   * Performance metrics
   */
  __SZ_METRICS__?: PerformanceMetrics;

  /**
   * Debug mode flag
   */
  __SZ_DEBUG__?: boolean;
}

/**
 * Type guard to check if window has csszyx extensions.
 *
 * @param {Window} win - Window object to check
 * @returns {win is CsszyxWindow} True if window has csszyx extensions
 */
export function isCsszyxWindow(win: Window): win is CsszyxWindow {
    return '__SZ_RUNTIME_STATE__' in win || '__SZ_ALLOW_CSR_RECOVERY__' in win;
}
