/**
 * @csszyx/compiler - TypeScript compiler package for csszyx.
 *
 * The `sz` types, the TypeScript lowering, the property and diagnostic
 * tables, recovery tokens and manifests. Nothing here loads the engine:
 * `@csszyx/compiler/engine` holds every function that calls it.
 *
 * @module @csszyx/compiler
 */

import { version as packageVersion } from '../package.json';

// Export transform functionality
export { AST_BUDGET } from './ast-budget.js';
export {
    SZ_DIAGNOSTIC_CODES,
    SZ_DIAGNOSTIC_DEFAULT_LEVELS,
    SZ_DIAGNOSTIC_GROUP_IDS,
    SZ_REMOVED_DIAGNOSTIC_IDS,
    SZ_SETTABLE_DIAGNOSTIC_IDS,
    type SzDiagnosticArgsByCode,
    type SzDiagnosticCode,
    type SzDiagnosticGroupId,
    type SzDiagnosticId,
    type SzRemovedDiagnosticId,
    type SzSettableDiagnosticId,
} from './diagnostic-codes.generated.js';
export {
    type IdentifiedDiagnostic,
    isSzDiagnosticId,
    type RenderableDiagnostic,
    SZ_DIAGNOSTIC_URL_BASE,
    type SzDiagnosticComputed,
    type SzDiagnosticParts,
    szDiagnosticPositionOf,
} from './diagnostic-render.js';
export { SZ_DIAGNOSTIC_COMPUTED_VALUES } from './diagnostic-render-helpers.js';
export {
    renderSzDiagnostic,
    renderSzDiagnosticBody,
    renderSzDiagnosticParts,
} from './diagnostic-render-root.js';
export {
    diagnosticPath,
    renderEngineDiagnostics,
    renderUnplacedDiagnostic,
    szDiagnosticKey,
} from './engine-diagnostics.js';
export {
    restoreEngineSpans,
    type SourcePosition,
    type StoredEngineSpans,
    type SzDiagnosticIssue,
    type SzIssue,
    type SzMergeGroup,
    type SzMergeOverride,
    storeEngineSpans,
} from './engine-spans.js';
export type {
    GlobalVarSourceFile,
    GlobalVarUsageDiagnostic,
    GlobalVarUsageKind,
    GlobalVarUsageLocation,
    GlobalVarUsageQuery,
    ScanGlobalVarUsagesOptions,
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
export type {
    ModuleForward,
    ModuleLinks,
    ModuleLinksFile,
    ModuleLinksQuery,
} from './module-links.js';
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
    type SzFallbackConsequence,
    szFallbackConsequenceOf,
} from './sz-fallback-matrix.js';
// Export the diagnostic classifiers so the bundler and the CLI route
// diagnostics through the package that renders their wording.
export { nearestName, suggestSzKey } from './sz-key-suggestion.js';
// Export transform-core constants needed by MCP and CLI
export {
    BOOLEAN_SHORTHANDS,
    type CssVariableMangleValue,
    type EngineMergeTable,
    type GlobalVarAliasTableInput,
    isValidSzProp,
    KNOWN_SPECIAL_PROPERTIES,
    KNOWN_VARIANTS,
    normalizeClassName,
    PROPERTY_MAP,
    REMOVED_BOOLEAN_SUGAR,
    REPLACED_KEYS,
    type SourceTransformResult,
    SPECIAL_VARIANTS,
    SUGGESTION_MAP,
    type SzObject,
    type SzValue,
    type TransformOptions,
    type TransformSourceCodeOptions,
    transform,
} from './transform-core.js';

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
}

/**
 * Default compiler options.
 */
export const DEFAULT_COMPILER_OPTIONS: Required<CompilerOptions> = {
    buildId: Date.now().toString(),
    development: process.env.NODE_ENV !== 'production',
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
