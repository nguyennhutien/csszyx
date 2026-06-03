/**
 * Configuration types for csszyx.
 *
 * This module defines all configuration interfaces and types used
 * throughout the csszyx framework.
 */
import {
    CSSZYX_GLOBAL_ALIAS_PREFIX,
    isCsszyxGlobalAliasCustomProperty,
    isTailwindReservedCustomProperty,
} from './tailwind-reserved.js';

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
     * Enable CSS custom property name mangling and hoisting.
     *
     * This is an opt-in feature gate for the tiered CSS variable system.
     * When disabled, dynamic `sz` values keep the existing `--_sz-*`
     * variable names and no variable hoisting is applied.
     *
     * @default false
     */
    mangleVars: boolean;

    /**
     * Maximum cascade depth for component-tier CSS variable hoisting.
     *
     * Only used when `mangleVars` is enabled. Lower values prefer local scoped
     * variables; higher values allow hoisting across deeper DOM subtrees.
     *
     * @default 5
     */
    mangleVarHoistMaxDepth: number;

    /**
     * Alias stable app-owned global CSS custom properties.
     *
     * This is the opt-in gate for the `g` tier. Phase H v1 is alias-only:
     * original public custom-property declarations remain defined, and
     * csszyx-owned references may use short generated aliases. Explicit
     * `tokens` are supported first; `autoPrefix` remains blocked until CSS
     * pre-scan support exists.
     *
     * @default undefined (disabled)
     */
    mangleGlobalVars?: GlobalVarMangleConfig;

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
 * Supported global custom-property optimization mode.
 */
export type GlobalVarMangleMode = 'alias';

/**
 * Reaction to unsafe global custom-property usage.
 */
export type GlobalVarUnsafeUsageMode = 'error';

/**
 * Configuration for app-owned global custom-property aliases.
 */
export interface GlobalVarMangleConfig {
    /**
     * Master switch for global custom-property aliasing.
     *
     * @default false
     */
    enabled: boolean;

    /**
     * Phase H v1 only supports alias mode.
     *
     * @default "alias"
     */
    mode?: GlobalVarMangleMode;

    /**
     * Explicit app-owned custom-property names to alias.
     *
     * Every token must include the leading `--`.
     *
     * @default []
     */
    tokens?: string[];

    /**
     * Optional app-owned prefix discovery. Empty string disables prefix
     * discovery and requires explicit tokens.
     *
     * This must not default to a Tailwind namespace or the generated alias
     * prefix.
     *
     * @default ""
     */
    autoPrefix?: string;

    /**
     * Prefix used for generated global aliases.
     *
     * Phase H v1 defaults to `---g`, then appends csszyx's z-y-x encoder
     * output: `---gz`, `---gy`, `---gx`, ...
     *
     * @default "---g"
     */
    aliasPrefix?: string;

    /**
     * Unsafe usage handling. Phase H v1 keeps this as error-only.
     *
     * @default "error"
     */
    onUnsafeUsage?: GlobalVarUnsafeUsageMode;

    /**
     * Additional app-specific custom-property names or prefixes that must
     * never be aliased. Tailwind-owned prefixes are reserved implicitly by the
     * implementation.
     *
     * @default []
     */
    reserved?: string[];
}

/**
 * Validates the Phase H global variable alias config shape.
 *
 * @param config User-provided global variable alias config.
 * @returns Validation errors. Empty means the config shape is valid.
 */
export function validateGlobalVarMangleConfig(config: GlobalVarMangleConfig | undefined): string[] {
    if (!config) {
        return [];
    }

    const errors: string[] = [];
    if (config.mode !== undefined && config.mode !== 'alias') {
        errors.push("production.mangleGlobalVars.mode only supports 'alias' in Phase H v1.");
    }
    if (config.onUnsafeUsage !== undefined && config.onUnsafeUsage !== 'error') {
        errors.push(
            "production.mangleGlobalVars.onUnsafeUsage only supports 'error' in Phase H v1.",
        );
    }
    if (config.autoPrefix !== undefined && !isValidCustomPropertyPrefix(config.autoPrefix)) {
        errors.push('production.mangleGlobalVars.autoPrefix must be empty or start with "--".');
    } else if (
        config.autoPrefix !== undefined &&
        config.autoPrefix !== '' &&
        isTailwindReservedCustomProperty(config.autoPrefix)
    ) {
        errors.push(
            `production.mangleGlobalVars.autoPrefix cannot target Tailwind reserved namespace "${config.autoPrefix}".`,
        );
    } else if (
        config.autoPrefix !== undefined &&
        config.autoPrefix !== '' &&
        isCsszyxGlobalAliasCustomProperty(config.autoPrefix, resolveGlobalVarAliasPrefix(config))
    ) {
        errors.push(
            `production.mangleGlobalVars.autoPrefix cannot target csszyx reserved namespace "${resolveGlobalVarAliasPrefix(config)}*".`,
        );
    }
    if (
        config.aliasPrefix !== undefined &&
        (config.aliasPrefix === '' || !isValidCustomPropertyPrefix(config.aliasPrefix))
    ) {
        errors.push(
            'production.mangleGlobalVars.aliasPrefix must be non-empty and start with "--".',
        );
    } else if (
        config.aliasPrefix !== undefined &&
        isTailwindReservedCustomProperty(config.aliasPrefix)
    ) {
        errors.push(
            `production.mangleGlobalVars.aliasPrefix cannot target Tailwind reserved namespace "${config.aliasPrefix}".`,
        );
    } else if (
        config.autoPrefix !== undefined &&
        config.autoPrefix !== '' &&
        config.aliasPrefix !== undefined &&
        prefixesOverlap(config.autoPrefix, config.aliasPrefix)
    ) {
        errors.push(
            `production.mangleGlobalVars.aliasPrefix "${config.aliasPrefix}" must not overlap autoPrefix "${config.autoPrefix}".`,
        );
    }

    validateCustomPropertyList(
        config.tokens,
        'tokens',
        errors,
        resolveGlobalVarAliasPrefix(config),
    );
    validateCustomPropertyList(config.reserved, 'reserved', errors);

    return errors;
}

/**
 * Checks whether a custom-property discovery prefix is valid.
 *
 * @param prefix User-provided prefix.
 * @returns true when the prefix is empty or CSS custom-property-like.
 */
function isValidCustomPropertyPrefix(prefix: string): boolean {
    return prefix === '' || prefix.startsWith('--');
}

/**
 * Resolves the generated alias prefix.
 *
 * @param config User-provided global variable alias config.
 * @returns Active alias prefix.
 */
function resolveGlobalVarAliasPrefix(config: GlobalVarMangleConfig): string {
    return config.aliasPrefix ?? CSSZYX_GLOBAL_ALIAS_PREFIX;
}

/**
 * Checks whether two custom-property prefixes overlap.
 *
 * @param left First prefix.
 * @param right Second prefix.
 * @returns true when either prefix can include the other.
 */
function prefixesOverlap(left: string, right: string): boolean {
    return left.startsWith(right) || right.startsWith(left);
}

/**
 * Validates an optional list of custom-property names.
 *
 * @param values User-provided list.
 * @param field Field name for diagnostics.
 * @param errors Mutable error list.
 * @param aliasPrefix Active generated alias prefix.
 */
function validateCustomPropertyList(
    values: string[] | undefined,
    field: 'tokens' | 'reserved',
    errors: string[],
    aliasPrefix = CSSZYX_GLOBAL_ALIAS_PREFIX,
): void {
    if (!values) {
        return;
    }
    for (const value of values) {
        if (!value.startsWith('--')) {
            errors.push(`production.mangleGlobalVars.${field} entries must start with "--".`);
            return;
        }
        if (field === 'tokens' && isTailwindReservedCustomProperty(value)) {
            errors.push(
                `production.mangleGlobalVars.tokens cannot include Tailwind reserved namespace token "${value}".`,
            );
            return;
        }
        if (field === 'tokens' && isCsszyxGlobalAliasCustomProperty(value, aliasPrefix)) {
            errors.push(
                `production.mangleGlobalVars.tokens cannot include csszyx reserved namespace token "${value}".`,
            );
            return;
        }
    }
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
    mangleVars: false,
    mangleVarHoistMaxDepth: 5,
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
