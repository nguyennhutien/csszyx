/**
 * Phase H global variable alias surface.
 *
 * Public re-export barrel. The implementation is split across sibling files:
 *
 * - `global-var-types`     — shared types and interfaces
 * - `global-var-postcss`   — PostCSS traversal helpers
 * - `global-var-css-scan`  — CSS scanner (`scanGlobalVarCss`)
 * - `global-var-cache`     — scan result cache
 * - `global-var-planner`   — alias planner + Tailwind reserve check
 * - `global-var-rewriter`  — CSS alias rewriter
 * - `global-var-validation`— end-to-end orchestrator
 */

export { CSSZYX_GLOBAL_ALIAS_PREFIX, TAILWIND_RESERVED_PREFIXES } from '@csszyx/types';
export {
    createGlobalVarScanCacheKey,
    readGlobalVarScanCache,
    resolveGlobalVarScanCacheDir,
    writeGlobalVarScanCache,
} from './global-var-cache.js';
export { scanGlobalVarCss } from './global-var-css-scan.js';
export { isTailwindReservedGlobalVar, planGlobalVarAliases } from './global-var-planner.js';
export { rewriteGlobalVarCssAliases } from './global-var-rewriter.js';
export type {
    CreateGlobalVarAliasValidationOptionsInput,
    CssVarDefinition,
    CssVarLocation,
    CssVarReference,
    CssVarScanResult,
    GlobalVarAliasDiagnostic,
    GlobalVarAliasDiagnosticSeverity,
    GlobalVarAliasEntry,
    GlobalVarAliasPlan,
    GlobalVarAliasValidationResult,
    GlobalVarCodeSource,
    GlobalVarCssAliasRewriteResult,
    GlobalVarCssAssetSource,
    GlobalVarCssSource,
    GlobalVarScanCacheEntry,
    GlobalVarScanCacheKeyInput,
    PlanGlobalVarAliasesInput,
    RewriteGlobalVarCssAliasesOptions,
    ScanGlobalVarCssOptions,
    ValidateGlobalVarAliasInputsOptions,
} from './global-var-types.js';

export {
    createGlobalVarAliasValidationOptions,
    validateGlobalVarAliasInputs,
} from './global-var-validation.js';
