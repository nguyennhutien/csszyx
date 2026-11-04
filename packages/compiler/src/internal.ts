/**
 * What the csszyx packages share with one another and nobody else: the CLI
 * and the build plugin read the engine's output and choose an artifact with
 * it. A template adapter's kit is `@csszyx/compiler/template`, kept apart so
 * the build plugin loads it only for a template file. Its shape may change in
 * any release.
 *
 * @module internal
 * @internal Not a stable API.
 */

export {
    fillSzDiagnosticTemplate,
    type SzDiagnosticTemplate,
} from './diagnostic-template.js';
export { SZ_EDITOR_DIAGNOSTIC_TEMPLATES } from './editor-diagnostic-templates.generated.js';
export { type EmittedClassName, findEmittedClassName } from './emitted-class-name.js';
export {
    diagnosticFileOf,
    renderEngineDiagnostic,
    type UnrenderedTransformResult,
} from './engine-diagnostics.js';
export {
    isParserMode,
    type ParserMode,
    type ResolveParserModeInput,
    type ResolveParserModeResult,
    resolveParserMode,
} from './parser-mode.js';
export { transformRustBatchUnrendered, transformRustUnrendered } from './transform-rust.js';
export { transformSourceUnrendered } from './transform-select.js';
export { transformWasmUnrendered } from './transform-wasm.js';
