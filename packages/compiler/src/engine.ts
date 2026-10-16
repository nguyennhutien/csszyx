/**
 * `@csszyx/compiler/engine`: every function that calls the engine in
 * `@csszyx/core`.
 *
 * The package root never loads the engine, so a package that only needs the
 * `sz` types, the TypeScript lowering of `@csszyx/compiler/browser` or the
 * diagnostic tables installs no engine: `@csszyx/core` is an optional peer of
 * the compiler, and a package importing this subpath declares it.
 *
 * @module engine
 */

export {
    type CrossModuleExportKind,
    type CrossModuleForward,
    type CrossModuleRegistryEntry,
    extractCrossModuleForwards,
    extractCrossModuleRegistryEntries,
} from './cross-module-extract.js';
export {
    type AssertEngineIdentityInput,
    type EngineIdentity,
    EngineVersionSkewError,
} from './engine-identity.js';
export {
    type GlobalVarSourceFile,
    type GlobalVarUsageDiagnostic,
    type GlobalVarUsageKind,
    type GlobalVarUsageLocation,
    type GlobalVarUsageQuery,
    type ScanGlobalVarUsagesOptions,
    scanGlobalVarUsages,
} from './global-var-diagnostics.js';
export {
    type ModuleForward,
    type ModuleLinks,
    type ModuleLinksFile,
    type ModuleLinksQuery,
    scanModuleLinks,
} from './module-links.js';
export {
    ensureRustTransformAvailable,
    isRustTransformAvailable,
    RustTransformUnavailableError,
    scanGlobalVarUsagesRust,
    scanModuleLinksRust,
    type TransformRustFile,
    transformRust,
    transformRustBatch,
} from './transform-rust.js';
export { transformSource } from './transform-select.js';
export {
    isWasmTransformAvailable,
    scanGlobalVarUsagesWasm,
    scanModuleLinksWasm,
    transformWasm,
    transformWasmBatch,
    WasmTransformUnavailableError,
} from './transform-wasm.js';
