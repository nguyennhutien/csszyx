/**
 * @csszyx/compiler - TypeScript compiler package for csszyx.
 *
 * This package provides the core compilation functionality for csszyx,
 * including JSX transformation, recovery token generation, and manifest
 * creation.
 *
 * @module @csszyx/compiler
 */

// Export transform functionality
export { CsszyxCompiler } from './compiler.js';
export {
    isValidSzProp,
    normalizeClassName,
    type SzObject,
    type SzValue,
    transform,
    transformSourceCode,
} from './transform.js';

// Export transform-core constants needed by MCP and CLI
export {
    BOOLEAN_SHORTHANDS,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    SUGGESTION_MAP,
} from './transform-core.js';

// Export recovery token system
export {
    createRecoveryToken,
    generateRecoveryToken,
    injectRecoveryToken,
    isValidRecoveryMode,
    type RecoveryMode,
    type RecoveryToken,
    type TokenMetadata,
    validateSzRecover,
} from './recovery.js';

// Export manifest generation
export {
    ManifestBuilder,
    parseManifest,
    type RecoveryManifest,
    serializeManifest,
    type TokenData,
    validateManifest,
} from './manifest.js';

// Export property type system (for CSS Variable Auto-Compile)
export {
    COLOR_PROPERTIES,
    getCSSVariableName,
    getPropertyCategory,
    PROPERTY_CATEGORY_MAP,
    PropertyCategory,
} from './property-types.js';

// Export hoisting utilities
export {
    buildParentMap,
    type CSSVarUsage,
    hoistCSSVariables,
} from './hoisting.js';

// Export sz prop types (for IntelliSense and type safety)
// CustomTheme is the augmentable interface — exported so users and plugins can
// `declare module '@csszyx/compiler' { interface CustomTheme { colors: 'brand' } }`
export type {
    BackgroundProps,
    BorderProps,
    BorderRadiusValue,
    ColorName,
    ColorObjectValue,
    ColorPropValue,
    ColorShade,
    ColorValue,
    ContainerSize,
    CustomTheme,
    EffectsProps,
    FilterProps,
    FlexboxGridProps,
    FractionValue,
    InteractivityProps,
    LayoutProps,
    NegativeSpacingValue,
    ShadowValue,
    SizingProps,
    SpacingProps,
    SpacingScale,
    SpacingValue,
    SvgProps,
    SzProps,
    SzPropsBase,
    SzPropValue,
    TableProps,
    TransformProps,
    TransitionAnimationProps,
    TypographyProps,
    VariantModifiers,
} from './types/index.js';

/**
 * Compiler version.
 */
export const VERSION = '0.0.0';

/**
 * Compiler configuration options.
 */
export interface CompilerOptions {
  /**
   * Build ID (git hash or timestamp)
   */
  buildId?: string;

  /**
   * Enable development mode features
   */
  development?: boolean;

  /**
   * Strict mode - fail build on warnings
   */
  strictMode?: boolean;
}

/**
 * Default compiler options.
 */
export const DEFAULT_COMPILER_OPTIONS: Required<CompilerOptions> = {
    buildId: Date.now().toString(),
    development: process.env.NODE_ENV !== 'production',
    strictMode: false,
};

/**
 * Merges user options with defaults.
 *
 * @param {Partial<CompilerOptions>} options - User-provided options
 * @returns {Required<CompilerOptions>} Complete options object
 *
 * @example
 * ```typescript
 * const options = mergeOptions({ development: true });
 * ```
 */
export function mergeOptions(
    options: Partial<CompilerOptions> = {},
): Required<CompilerOptions> {
    return {
        ...DEFAULT_COMPILER_OPTIONS,
        ...options,
    };
}
