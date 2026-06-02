/**
 * @csszyx/types - Shared TypeScript types for csszyx.
 *
 * This package provides comprehensive type definitions used across
 * the csszyx framework, including configuration, runtime, and compiler types.
 *
 * @module @csszyx/types
 */

/**
 * Package version.
 */
export const VERSION = '0.0.0';

// Re-export all compiler types
export type {
    BuildPhase,
    BuildPhaseResult,
    BuildPhaseStatus,
    BuildResult,
    BuildStatistics,
    CacheEntry,
    CacheManager,
    CollisionResult,
    CompilerContext,
    CompilerOptions,
    CompilerPlugin,
    FileCompilationResult,
    GeneratedToken,
    MangleMapEntry,
    NodeLocation,
    TokenMetadata,
    TransformOptions,
    ValidationError,
    ValidationResult,
} from './compiler.js';
// Re-export all config types
export type {
    BuildConfig,
    CsszyxConfig,
    DevelopmentConfig,
    Environment,
    GlobalVarMangleConfig,
    GlobalVarMangleMode,
    GlobalVarUnsafeUsageMode,
    HydrationConfig,
    PartialCsszyxConfig,
    PerformanceConfig,
    ProductionConfig,
} from './config.js';
export {
    DEFAULT_BUILD_CONFIG,
    DEFAULT_CSSZYX_CONFIG,
    DEFAULT_DEVELOPMENT_CONFIG,
    DEFAULT_HYDRATION_CONFIG,
    DEFAULT_PERFORMANCE_CONFIG,
    DEFAULT_PRODUCTION_CONFIG,
    getCurrentEnvironment,
    validateGlobalVarMangleConfig,
} from './config.js';
// Re-export core WASM contract
export type { CsszyxCorePkg, CsszyxCoreWasm } from './core.js';
// Export JSX types (also auto-augments React namespace)
export type { SzProps, SzPropValue } from './jsx.js';
// Re-export all runtime types
export type {
    AuditLogEntry,
    ComponentPropsWithSz,
    CsszyxWindow,
    HydrationError,
    HydrationErrorType,
    MangleMap,
    MangleMapMetadata,
    PerformanceMetrics,
    RecoveryManifest,
    RecoveryMode,
    RuntimeState,
    SzProp,
    TokenData,
    VerificationResult,
} from './runtime.js';
export { isCsszyxWindow } from './runtime.js';
