/**
 * @csszyx/compiler - TypeScript compiler package for csszyx.
 *
 * This package provides the core compilation functionality for csszyx,
 * including JSX transformation, recovery token generation, and manifest
 * creation.
 *
 * @module @csszyx/compiler
 */

import { version as packageVersion } from '../package.json';

// Export transform functionality
export { AST_BUDGET, ASTBudgetExceededError } from './ast-budget.js';
export { CsszyxCompiler } from './compiler.js';
export {
    type CrossModuleExportKind,
    type CrossModuleForward,
    type CrossModuleRegistryEntry,
    extractCrossModuleForwards,
    extractCrossModuleRegistryEntries,
} from './cross-module-extract.js';
export {
    type GlobalVarUsageDiagnostic,
    type GlobalVarUsageKind,
    type GlobalVarUsageLocation,
    type ScanGlobalVarUsagesOptions,
    scanGlobalVarUsages,
} from './global-var-diagnostics.js';
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
export { sortStrings } from './sort.js';
export {
    explainStaticObjectLiteral,
    parseStaticObjectLiteral,
    type StaticObjectResult,
} from './static-object-parser.js';
// Export the fallback-consequence classifier so the bundler routes
// diagnostics through the module that renders their labels.
export {
    type SzFallbackConsequence,
    szFallbackConsequenceOf,
} from './sz-fallback-matrix.js';
// Export transform-core constants needed by MCP and CLI
export {
    BOOLEAN_SHORTHANDS,
    type CssVariableMangleValue,
    type GlobalVarAliasTableInput,
    isValidSzProp,
    KNOWN_SPECIAL_PROPERTIES,
    KNOWN_VARIANTS,
    normalizeClassName,
    PROPERTY_MAP,
    REMOVED_BOOLEAN_SUGAR,
    type SourceTransformResult,
    SPECIAL_VARIANTS,
    SUGGESTION_MAP,
    type SzObject,
    type SzValue,
    type TransformSourceCodeOptions,
    transform,
} from './transform-core.js';
export {
    ensureRustTransformAvailable,
    isRustTransformAvailable,
    OxcRustNotImplementedError,
    type TransformRustFile,
    transformRust,
    transformRustBatch,
} from './transform-rust.js';
export { transformSource } from './transform-select.js';
export {
    isWasmTransformAvailable,
    transformWasm,
    transformWasmBatch,
    WasmTransformUnavailableError,
} from './transform-wasm.js';

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
    SzArrayElement,
    SzProps,
    SzPropsBase,
    SzPropValue,
    Szs,
    SzsCompiled,
    SzsProps,
    TableProps,
    TransformProps,
    TransitionAnimationProps,
    TypographyProps,
    VariantModifiers,
} from './types/index.js';

/**
 * Compiler version.
 */
export const VERSION: string = packageVersion;

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
export function mergeOptions(options: Partial<CompilerOptions> = {}): Required<CompilerOptions> {
    return {
        ...DEFAULT_COMPILER_OPTIONS,
        ...options,
    };
}
