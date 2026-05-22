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
     * Enable the per-file transform cache.
     *
     * @default true
     */
    cache?: boolean;

    /**
     * Maximum AST nodes per file before warning.
     *
     * @default 50000
     */
    astBudgetLimit?: number;

    /**
     * Source parser used for JSX/TSX sz transforms.
     *
     * `rust` is the default parser. The Rust engine ships through the
     * matching optional `@csszyx/core-*` platform package. The package
     * installs automatically as an optional dependency on supported
     * platforms; when missing, csszyx fails loudly with an actionable error
     * rather than silently falling back. Set this option to `oxc` to keep
     * the previous JavaScript oxc-parser path, or to `babel` as a final
     * compatibility escape hatch.
     *
     * @default "rust"
     */
    parser?: 'babel' | 'oxc' | 'rust';

    /**
     * CSS file(s) to scan for Tailwind v4 @theme blocks.
     * When set, the plugin generates .csszyx/theme.d.ts with TypeScript augmentation
     * for custom design tokens, enabling IntelliSense for user-defined colors, spacings, etc.
     *
     * Accepts a single glob/path or an array of globs/paths.
     *
     * @example ['src/styles/theme.css', 'src/styles/tokens.css']
     */
    scanCss?: string | string[];
}

/**
 * File patterns accepted by csszyx plugin filters.
 *
 * String patterns may be literal paths (`src/generated/icon-dump.tsx`) or
 * simple globs such as `src/generated/**` or any TSX file. RegExp patterns are matched
 * against both absolute paths and paths relative to the project root.
 */
export type FilePattern = string | RegExp;

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
    /**
     * Restrict source files that csszyx transforms.
     *
     * CSS files used for Tailwind class discovery are still processed unless
     * excluded explicitly, so narrow source includes do not accidentally disable
     * CSS safelist injection.
     */
    include?: FilePattern | FilePattern[];

    /**
     * Exclude files from csszyx processing before parsing.
     *
     * Use this for large generated source files that happen to contain an `sz`
     * marker and would otherwise hit the AST budget guard.
     */
    exclude?: FilePattern | FilePattern[];

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
    strictMode: false,
    debug: false,
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
    cache: true,
    astBudgetLimit: 50000,
    parser: 'rust',
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
    if (env === 'production') {
        return 'production';
    }
    if (env === 'test') {
        return 'test';
    }
    return 'development';
}
