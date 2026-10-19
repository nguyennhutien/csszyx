/**
 * What the csszyx packages share with one another and nobody else: the Vue
 * and Svelte adapters lower template `sz` through it, and the
 * CLI and the build plugin read the engine's output and choose an artifact
 * with it. Its shape follows the adapters and may change in any release.
 *
 * @module internal
 * @internal Not a stable API.
 */

export type { SourceMap } from 'magic-string';
export {
    fillSzDiagnosticTemplate,
    type SzDiagnosticTemplate,
} from './diagnostic-template.js';
export { SZ_EDITOR_DIAGNOSTIC_TEMPLATES } from './editor-diagnostic-templates.generated.js';
export { type EmittedClassName, findEmittedClassName } from './emitted-class-name.js';
export {
    isParserMode,
    type ParserMode,
    type ResolveParserModeInput,
    type ResolveParserModeResult,
    resolveParserMode,
} from './parser-mode.js';
export { type RequirePeerInput, requirePeer } from './peer-module.js';
export {
    mayHoldSzAttribute,
    type PlaceTemplateDiagnosticInput,
    placeTemplateDiagnostic,
    reportTemplateSzDiagnostics,
    rewriteTemplateSz,
    type TemplateSzAttribute,
    type TemplateSzDiagnostic,
    type TemplateSzLowering,
    type TemplateSzOptions,
    type TemplateSzReporter,
    type TemplateSzRewrite,
    type TemplateSzValue,
    transformTemplateFile,
} from './template-sz.js';
