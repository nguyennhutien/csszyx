/**
 * Configuration types for csszyx.
 *
 * This module defines all configuration interfaces and types used
 * throughout the csszyx framework.
 */

/**
 * Development mode configuration options.
 */
export interface DevelopmentConfig {
  /**
   * Automatically inject recovery tokens for all components.
   * When enabled, all components get szRecover="dev-only" by default.
   *
   * @default false
   */
  autoInjectRecovery: boolean;

  /**
   * Enable strict mode - fail build on warnings.
   * When enabled, warnings are treated as errors.
   *
   * @default false
   */
  strictMode: boolean;

  /**
   * Enable debug logging during build.
   *
   * @default false
   */
  debug: boolean;

  /**
   * Allow client-side recovery on hydration mismatch.
   * Only works in development mode.
   *
   * @default true
   */
  allowCSRRecovery: boolean;
}

/**
 * Production mode configuration options.
 */
export interface ProductionConfig {
  /**
   * Enable global class name mangling.
   * Minifies class names to single characters (a, b, c, etc.).
   *
   * @default true
   */
  mangle: boolean;

  /**
   * Enable content hashing for immutable caching.
   *
   * @default true
   */
  contentHashing: boolean;

  /**
   * Inject checksum for SSR hydration validation.
   *
   * @default true
   */
  injectChecksum: boolean;

  /**
   * Enable incremental build caching.
   *
   * @default true
   */
  incrementalBuild: boolean;

  /**
   * Minify output (class names and attributes).
   *
   * @default true in production
   */
  minify: boolean;
}

/**
 * Build pipeline configuration.
 */
export interface BuildConfig {
  /**
   * Build ID (git hash or timestamp).
   * Auto-generated if not provided.
   */
  buildId?: string;

  /**
   * Path to Tailwind config file.
   *
   * @default "tailwind.config.js"
   */
  tailwindConfig?: string;

  /**
   * Output directory for generated files.
   *
   * @default ".csszyx"
   */
  outputDir?: string;

  /**
   * Cache directory for incremental builds.
   *
   * @default ".csszyx/cache"
   */
  cacheDir?: string;

  /**
   * Maximum AST nodes per file before warning.
   *
   * @default 50000
   */
  astBudgetLimit?: number;
}

/**
 * Hydration safety configuration.
 */
export interface HydrationConfig {
  /**
   * Enable strict hydration checks.
   * When enabled, hydration mismatches trigger abort protocol.
   *
   * @default true
   */
  strict: boolean;

  /**
   * Default recovery mode for components without explicit szRecover.
   *
   * @default null (no recovery)
   */
  defaultRecoveryMode?: 'csr' | 'dev-only' | null;

  /**
   * Enable hydration audit logging.
   *
   * @default true
   */
  auditLog: boolean;
}

/**
 * Performance optimization configuration.
 */
export interface PerformanceConfig {
  /**
   * Enable parallel processing during build.
   *
   * @default true
   */
  parallel: boolean;

  /**
   * Number of worker threads for parallel processing.
   * Auto-detected if not provided.
   */
  workers?: number;

  /**
   * Enable CSS variable optimization.
   *
   * @default true
   */
  optimizeVariables: boolean;

  /**
   * Enable zero-runtime optimization for static cases.
   *
   * @default true
   */
  zeroRuntime: boolean;
}

/**
 * Main csszyx configuration.
 */
export interface CsszyxConfig {
  /**
   * Development mode configuration.
   */
  development: DevelopmentConfig;

  /**
   * Production mode configuration.
   */
  production: ProductionConfig;

  /**
   * Build pipeline configuration.
   */
  build: BuildConfig;

  /**
   * Hydration safety configuration.
   */
  hydration: HydrationConfig;

  /**
   * Performance optimization configuration.
   */
  performance: PerformanceConfig;
}

/**
 * Partial configuration for user-provided config.
 * All fields are optional and will be merged with defaults.
 */
export type PartialCsszyxConfig = {
  development?: Partial<DevelopmentConfig>;
  production?: Partial<ProductionConfig>;
  build?: Partial<BuildConfig>;
  hydration?: Partial<HydrationConfig>;
  performance?: Partial<PerformanceConfig>;
};

/**
 * Default development configuration.
 */
export const DEFAULT_DEVELOPMENT_CONFIG: DevelopmentConfig = {
    autoInjectRecovery: false,
    strictMode: false,
    debug: false,
    allowCSRRecovery: true,
};

/**
 * Default production configuration.
 */
export const DEFAULT_PRODUCTION_CONFIG: ProductionConfig = {
    mangle: true,
    contentHashing: true,
    injectChecksum: true,
    incrementalBuild: true,
    minify: true,
};

/**
 * Default build configuration.
 */
export const DEFAULT_BUILD_CONFIG: BuildConfig = {
    tailwindConfig: 'tailwind.config.js',
    outputDir: '.csszyx',
    cacheDir: '.csszyx/cache',
    astBudgetLimit: 50000,
};

/**
 * Default hydration configuration.
 */
export const DEFAULT_HYDRATION_CONFIG: HydrationConfig = {
    strict: true,
    defaultRecoveryMode: null,
    auditLog: true,
};

/**
 * Default performance configuration.
 */
export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
    parallel: true,
    optimizeVariables: true,
    zeroRuntime: true,
};

/**
 * Default csszyx configuration.
 */
export const DEFAULT_CSSZYX_CONFIG: CsszyxConfig = {
    development: DEFAULT_DEVELOPMENT_CONFIG,
    production: DEFAULT_PRODUCTION_CONFIG,
    build: DEFAULT_BUILD_CONFIG,
    hydration: DEFAULT_HYDRATION_CONFIG,
    performance: DEFAULT_PERFORMANCE_CONFIG,
};

/**
 * Environment type.
 */
export type Environment = 'development' | 'production' | 'test';

/**
 * Gets the current environment.
 *
 * @returns {Environment} Current environment
 */
export function getCurrentEnvironment(): Environment {
    const env = process.env.NODE_ENV;
    if (env === 'production') {return 'production';}
    if (env === 'test') {return 'test';}
    return 'development';
}
